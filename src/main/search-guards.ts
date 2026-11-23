/**
 * 第 3 阶段检索护栏（全部硬编码，按验收口径生效）。
 * 说明：这些是「上限/熔断」护栏，不是偏好权重；检索源与排序不因用户偏好改变。
 */

/** 最大改写查询轮次（首轮 + 最多 2 轮改写 → 总轮次上限 3） */
export const MAX_SEARCH_ROUNDS = 3;
/** 每个数据源、单条查询的返回上限（防止单源洪泛与限流） */
export const PER_SOURCE_CAP = 30;
/** 进入池内重排前的候选池总上限（超出按预排截断，防止 token 失控） */
export const POOL_CAP = 300;
/** 每侧池进入 LLM 重排的条数上限（单批） */
export const RERANK_BATCH = 40;
/** 单批触发模型上下文/token 上限时，自动降级的分批大小（不截断候选池） */
export const RERANK_BATCH_MIN = 25;
/** 单次检索请求超时（毫秒） */
export const SEARCH_REQUEST_TIMEOUT_MS = 30_000;
/** 知网抓取请求超时（毫秒，失败即降级） */
export const CNKI_REQUEST_TIMEOUT_MS = 15_000;
/** 单轮重排 LLM 调用超时（毫秒） */
export const RERANK_TIMEOUT_MS = 240_000;
/** 一次检索（含全部轮次）的总超时护栏（毫秒） */
export const TOTAL_SEARCH_TIMEOUT_MS = 300_000;
/** 检索计划生成 LLM 输出 token 预算 */
export const PLAN_MAX_TOKENS = 4_000;
/** 池内重排 LLM 输出 token 预算（每批；思考模型推理占输出预算，需留足） */
export const RERANK_MAX_TOKENS = 8_000;
/** 改写查询 LLM 输出 token 预算 */
export const REWRITE_MAX_TOKENS = 2_000;
/** 改写查询每轮最多新增查询数 */
export const REWRITE_MAX_QUERIES = 6;
/** 相关性分数区间（0-10 整数） */
export const RERANK_SCORE_MIN = 0;
export const RERANK_SCORE_MAX = 10;

/** 目标源白名单（LLM 检索计划里允许出现的源；其余一律忽略） */
export const ALLOWED_PLAN_SOURCES = ["cnki", "hanspub", "openalex", "crossref", "google-scholar", "base"] as const;
/** 真实取回源（google-scholar/base 为跳转链接源，不进入真实召回） */
export const REAL_RETRIEVAL_SOURCES = ["cnki", "hanspub", "openalex", "crossref"] as const;
