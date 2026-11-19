"""
全流程论文制作 · RAG 接地管线骨架
================================

把「文献库 → 向量检索 → 拼【材料清单】→ 调 LLM → 解析 JSON → 渲染缺口清单」
这条链路串起来。设计原则：

1. 模型无关：LLM 走 OpenAI 兼容端点（DeepSeek / Qwen / OpenAI / 大多数中转都吃这套），
   Claude 单独留一个适配点（见 LLMClient.complete 内的注释）。
2. 向量库可换：默认 Chroma（嵌入式、免部署），想换 LanceDB / sqlite-vec / Qdrant
   只需改 VectorStore 这个类，其余不动。
3. 防编造靠「接地 + 缺口」，不靠「回避」：检索结果就是【材料清单】，模型只准引用
   清单里的 source_id；写不出的论断进 gaps，不写「待核验」占位。
4. 输出是纯 JSON，不依赖任何一家的 function calling。

依赖见 requirements.txt。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

# --------------------------------------------------------------------------- #
# 0. 系统提示词（与「学术论文写作系统提示词.md」里的 text 块保持一致）
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = """\
你是一名严谨的学术论文全流程写作助手，负责辅助研究者完成从零到成稿的全过程：
文献梳理 → 选题开题 → 假设构建 → 正文草稿 → 审稿修改。

你的输出会被一个程序解析，因此必须严格遵守文末的输出格式，且只输出一个 JSON 对象，不要输出任何额外文字、解释或 Markdown 代码块。

【最高准则：接地，而非编造；写出，而非回避】

1. 每一条事实性陈述，必须能对应到「用户消息中的【材料清单】」里的一个来源。
2. 有依据就写，并且在句末用 [@source_id] 标注来源。
3. 没有依据时，禁止写「待核验」「需进一步验证」这类占位废话。正确做法是：
   - 基于已有材料，写出你能给出的最好草稿（不因缺料而整段不写）；
   - 把「缺乏依据的具体论断」逐条收进 gaps 数组，说明缺什么、用户补上什么材料后就能补全。
4. 你的「保守」不是「不敢写」，而是「写了就明确它依据在哪」。宁可草稿带缺口，不可正文有编造。

【引用规则】

- 正文中凡有具体事实来源的句子，句末用 [@source_id] 标注，source_id 必须来自【材料清单】里真实存在的编号。
- 通用常识、学科方法学通识、纯逻辑推理不需要引用；但「某研究做了X」「某数据显示Y」「某作者提出Z」这类具体论断必须引用。
- 材料里没有对应来源时，不得伪造 source_id；该论断转入 gaps。

【工作流】

按用户指定的阶段执行；用户未指定时，按顺序推进。每次只输出当前阶段的 JSON：

1. 文献梳理：归纳【材料清单】，输出主题地图、已有共识、关键空白。
2. 开题框架：产出研究问题、研究意义、研究假设、拟用方法，形成开题大纲。
3. 假设卡片：把每个假设写成「可证伪命题 + 支持依据(带引用) + 待验证点」。
4. 正文草稿：按章节撰写，逐段标注引用，未定的部分进 gaps。
5. 审稿修改：自我批判，标出逻辑漏洞、证据不足、表述问题，并给出修改版。

【输出格式】

只返回一个 JSON 对象，结构如下（字段名固定，不要增删）：

{
  "stage": "当前阶段名",
  "content": "正文，Markdown 格式，事实句句末带 [@source_id]",
  "claims": [
    {"statement": "论断原文", "source_ids": ["ref_1"], "status": "grounded"}
  ],
  "gaps": [
    {"claim": "缺乏依据的论断", "missing": "缺什么", "action": "建议用户补充什么材料"}
  ],
  "next_steps": ["下一步建议"]
}

【风格】

- 用中文，学术、克制，不堆砌套话，能用材料说话就不空谈。
- 不确定时明确写「不确定」，并把不确定性落进 gap，而不是含糊带过。
- 正文密度高、可编辑性强，方便研究者直接在其上修改。
"""


# --------------------------------------------------------------------------- #
# 1. 数据结构
# --------------------------------------------------------------------------- #

@dataclass
class Chunk:
    """一个待入库/已入库的文本块。"""
    source_id: str          # 稳定来源编号，如 doc_<hash8>
    title: str              # 文献标题 / 文档名
    text: str
    metadata: dict = field(default_factory=dict)


@dataclass
class Retrieved:
    """一次检索命中。"""
    source_id: str
    title: str
    text: str
    score: float


# --------------------------------------------------------------------------- #
# 2. 嵌入模型（可换）
# --------------------------------------------------------------------------- #

class Embedder(Protocol):
    """把文本变成向量。本地 / 远程 API 都可以实现这个接口。"""
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LocalEmbedder:
    """默认：本地 sentence-transformers，零 API 依赖。bge-m3 中文好、多语言。"""
    def __init__(self, model_name: str = "BAAI/bge-m3"):
        from sentence_transformers import SentenceTransformer  # 延迟导入，可选依赖
        self._model = SentenceTransformer(model_name)

    def embed(self, texts: list[str]) -> list[list[float]]:
        # normalize_embeddings=True 让余弦相似度 = 点积，Chroma 默认算距离更准
        vecs = self._model.encode(texts, normalize_embeddings=True)
        return [v.tolist() for v in vecs]


class OpenAICompatEmbedder:
    """远程嵌入端点（OpenAI / 硅基流动 / 其他兼容服务）。"""
    def __init__(self, base_url: str, api_key: str, model: str):
        import httpx
        self._client = httpx.Client(base_url=base_url, timeout=60)
        self._api_key = api_key
        self._model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        r = self._client.post(
            "/embeddings",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={"model": self._model, "input": texts},
        )
        r.raise_for_status()
        data = r.json()["data"]
        data.sort(key=lambda x: x["index"])
        return [d["embedding"] for d in data]


# --------------------------------------------------------------------------- #
# 3. 向量库（可换）
# --------------------------------------------------------------------------- #

class VectorStore:
    """默认 Chroma。想换 LanceDB / Qdrant 只改这个类。"""

    def __init__(self, persist_dir: str = "./paper_db", embedder: Embedder | None = None):
        import chromadb  # 延迟导入
        self._embedder = embedder or LocalEmbedder()
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="paper_chunks", metadata={"hnsw:space": "cosine"}
        )

    def add(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        texts = [c.text for c in chunks]
        vecs = self._embedder.embed(texts)
        self._collection.add(
            ids=[_stable_id(c.source_id, c.text) for c in chunks],
            embeddings=vecs,
            documents=texts,
            metadatas=[{"source_id": c.source_id, "title": c.title, **c.metadata} for c in chunks],
        )

    def search(self, query: str, top_k: int = 5) -> list[Retrieved]:
        q = self._embedder.embed([query])[0]
        res = self._collection.query(query_embeddings=[q], n_results=top_k)
        out: list[Retrieved] = []
        for i, doc in enumerate(res["documents"][0]):
            meta = res["metadatas"][0][i]
            dist = res["distances"][0][i]
            score = 1.0 - dist  # 余弦距离 -> 相似度
            out.append(Retrieved(meta["source_id"], meta.get("title", ""), doc, score))
        return out


# --------------------------------------------------------------------------- #
# 4. LLM 客户端（模型无关）
# --------------------------------------------------------------------------- #

class LLMClient:
    """OpenAI 兼容端点。Claude 原生 API 见 complete() 内注释。"""

    def __init__(self, base_url: str, api_key: str, model: str):
        import httpx
        self._client = httpx.Client(base_url=base_url, timeout=180)
        self._api_key = api_key
        self._model = model

    def complete(self, system: str, user: str, temperature: float = 0.4) -> str:
        r = self._client.post(
            "/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": self._model,
                "temperature": temperature,
                # 多数兼容端点支持；个别服务会报错则删掉这行，靠提示词「只返回 JSON」兜底
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

        # --- Claude 原生端点适配（换用这个分支）---
        # 用 anthropic SDK：
        #   from anthropic import Anthropic
        #   client = Anthropic(api_key=...)
        #   msg = client.messages.create(
        #       model=self._model, max_tokens=4096, temperature=temperature,
        #       system=system,
        #       messages=[{"role": "user", "content": user}],
        #   )
        #   return msg.content[0].text


# --------------------------------------------------------------------------- #
# 5. 文本分块
# --------------------------------------------------------------------------- #

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> list[str]:
    """简单字符分块（可按段落/句子升级）。overlap 防止切断事实句。"""
    if len(text) <= chunk_size:
        return [text]
    chunks, start = [], 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return chunks


def _stable_id(source_id: str, text: str) -> str:
    h = hashlib.md5(text.encode("utf-8")).hexdigest()[:12]
    return f"{source_id}_{h}"


# --------------------------------------------------------------------------- #
# 6. 管线
# --------------------------------------------------------------------------- #

class PaperPipeline:
    def __init__(
        self,
        store: VectorStore,
        llm: LLMClient,
        system_prompt: str = SYSTEM_PROMPT,
    ):
        self.store = store
        self.llm = llm
        self.system_prompt = system_prompt

    # ---- 写入 ----
    def ingest_document(self, source_id: str, title: str, text: str) -> None:
        """把一个文献/文档切块入库。source_id 建议用稳定的论文 ID（如 arxiv 号）。"""
        chunks = [
            Chunk(source_id=source_id, title=title, text=t)
            for t in chunk_text(text)
        ]
        self.store.add(chunks)

    # ---- 检索 + 拼【材料清单】----
    def build_materials(self, query: str, top_k: int = 5) -> tuple[str, list[Retrieved]]:
        """检索并拼成喂给模型的【材料清单】文本。返回 (清单文本, 命中列表)。"""
        hits = self.store.search(query, top_k)
        lines = []
        for h in hits:
            lines.append(f"[{h.source_id}] 《{h.title}》\n{h.text.strip()}")
        return "【材料清单】\n\n" + "\n\n---\n\n".join(lines), hits

    # ---- 生成 ----
    def generate(self, user_instruction: str, query: str | None = None, top_k: int = 5) -> dict:
        """一次完整调用：检索 → 拼清单 → 调模型 → 解析 JSON。"""
        if query is None:
            query = user_instruction  # 没单独给检索词时，用指令本身去检索
        materials, _ = self.build_materials(query, top_k)
        user_msg = f"{materials}\n\n{user_instruction}"
        raw = self.llm.complete(self.system_prompt, user_msg)
        return parse_response(raw)

    # ---- 渲染缺口清单 ----
    @staticmethod
    def render_gaps_markdown(gaps: list[dict]) -> str:
        if not gaps:
            return "（无缺口）"
        lines = ["### 缺口清单", ""]
        for i, g in enumerate(gaps, 1):
            lines.append(f"{i}. **{g.get('claim', '')}**")
            lines.append(f"   - 缺什么：{g.get('missing', '')}")
            lines.append(f"   - 怎么补：{g.get('action', '')}")
        return "\n".join(lines)

    @staticmethod
    def render_gaps_html(gaps: list[dict]) -> str:
        """给前端用的 HTML 片段（可再套上你的 UI 样式）。"""
        if not gaps:
            return "<p>（无缺口）</p>"
        items = "".join(
            f"<li><strong>{_esc(g.get('claim', ''))}</strong>"
            f"<br>缺什么：{_esc(g.get('missing', ''))}"
            f"<br>怎么补：{_esc(g.get('action', ''))}</li>"
            for g in gaps
        )
        return f"<ul>{items}</ul>"


# --------------------------------------------------------------------------- #
# 7. 输出解析（健壮版）
# --------------------------------------------------------------------------- #

def _extract_json(text: str) -> Any:
    """模型偶尔会包 Markdown 围栏或加前缀废话，这里兜底。"""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("响应中没有找到 JSON 对象")
    return json.loads(t[start : end + 1])


def parse_response(raw: str) -> dict:
    """把模型原始输出解析成规范 dict，缺字段给安全默认值。"""
    data = _extract_json(raw)
    return {
        "stage": data.get("stage", "unknown"),
        "content": data.get("content", ""),
        "claims": data.get("claims", []),
        "gaps": data.get("gaps", []),
        "next_steps": data.get("next_steps", []),
    }


def _esc(s: str) -> str:
    import html
    return html.escape(str(s))


# --------------------------------------------------------------------------- #
# 8. 示例入口
# --------------------------------------------------------------------------- #

def demo():
    # 1) 用环境变量注入，别硬编码密钥
    llm = LLMClient(
        base_url=os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
        api_key=os.environ.get("LLM_API_KEY", "sk-..."),
        model=os.environ.get("LLM_MODEL", "gpt-4o-mini"),
    )
    store = VectorStore(persist_dir="./paper_db")  # 默认本地嵌入，可换成 OpenAICompatEmbedder
    pipe = PaperPipeline(store, llm)

    # 2) 灌入文献（真实使用时替换成从 PDF/网页抓来的正文）
    pipe.ingest_document("arxiv_2410.00001", "Example Paper", "……文献正文……")

    # 3) 跑一次
    result = pipe.generate(
        user_instruction="根据材料，帮我写一个开题框架的研究假设部分。",
    )

    # 4) 输出
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("\n" + PaperPipeline.render_gaps_markdown(result["gaps"]))


if __name__ == "__main__":
    demo()
