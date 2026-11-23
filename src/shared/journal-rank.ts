/**
 * 期刊等级静态清单（真实期刊名；比对题录中的刊名后打标记）。
 * 口径：
 *  - CSSCI：中文社会科学引文索引来源期刊（经管/社科为主，精选常见子集）
 *  - 北大核心：中文核心期刊要目总览（精选常见子集）
 *  - SCI/SSCI：国际权威期刊（精选常见子集）
 * 清单可后期更新：应用数据目录放 journal-rank.json（{ csci:[], pku:[], sciSsi:[] }），
 * 加载时与内置清单合并（外部清单只增不删）。
 */

export const CSSCI_JOURNALS: string[] = [
  "经济研究", "管理世界", "中国工业经济", "南开管理评论", "管理科学学报", "会计研究", "金融研究",
  "财贸经济", "数量经济技术经济研究", "中国农村经济", "中国人口·资源与环境", "管理评论",
  "管理工程学报", "管理学报", "经济管理", "外国经济与管理", "软科学", "科学学研究",
  "科学学与科学技术管理", "科研管理", "中国软科学", "系统工程理论与实践", "营销科学学报",
  "商业经济与管理", "财贸研究", "国际贸易问题", "国际经贸探索", "世界经济", "经济学动态",
  "经济学家", "财经研究", "财经科学", "当代财经", "经济理论与经济管理", "经济体制改革", "改革",
  "宏观经济研究", "城市问题", "旅游学刊", "心理学报", "心理科学进展", "新闻与传播研究", "现代传播",
  "中国电化教育", "情报学报", "图书情报工作", "数据分析与知识发现", "管理案例研究与评论", "电子政务",
  "信息资源管理学报", "系统工程", "运筹与管理", "管理现代化", "科技进步与对策", "科技管理研究",
  "情报科学", "情报理论与实践", "商业研究", "消费经济", "价格理论与实践", "中国流通经济",
  "中央财经大学学报", "上海财经大学学报", "国际贸易", "国际商务", "世界经济研究", "亚太经济",
  "经济社会体制比较", "当代经济研究", "当代经济科学", "中南财经政法大学学报", "财经理论与实践",
  "审计与经济研究", "金融经济学研究", "证券市场导报", "保险研究", "国际金融研究", "税务研究",
  "财政研究", "经济学(季刊)", "南开经济研究", "产业经济研究", "中国管理科学", "管理科学", "预测",
  "心理科学", "应用心理学", "华东经济管理", "西部论坛", "中国青年研究", "青年研究", "妇女研究论丛",
  "人口研究", "人口与经济", "社会学研究", "社会", "教育研究", "高等教育研究", "中国高教研究",
  "电化教育研究", "远程教育杂志", "开放教育研究", "华东师范大学学报(教育科学版)", "比较教育研究",
  "清华大学教育研究", "北京大学教育评论", "现代远程教育研究", "现代教育技术", "中国远程教育",
  "中国人民大学学报", "北京大学学报(哲学社会科学版)", "清华大学学报(哲学社会科学版)", "复旦学报(社会科学版)",
  "南京大学学报(哲学·人文科学·社会科学)", "武汉大学学报(哲学社会科学版)", "中山大学学报(社会科学版)",
  "厦门大学学报(哲学社会科学版)", "浙江大学学报(人文社会科学版)", "吉林大学社会科学学报",
  "四川大学学报(哲学社会科学版)", "山东大学学报(哲学社会科学版)", "兰州大学学报(社会科学版)",
  "湖南大学学报(社会科学版)", "北京师范大学学报(社会科学版)", "华东师范大学学报(哲学社会科学版)",
  "华中师范大学学报(人文社会科学版)", "南京农业大学学报(社会科学版)", "华中农业大学学报(社会科学版)",
  "华南农业大学学报(社会科学版)", "西安交通大学学报(社会科学版)", "大连理工大学学报(社会科学版)",
  "重庆大学学报(社会科学版)", "江苏社会科学", "江海学刊", "社会科学战线", "学术月刊", "学术界",
  "南京社会科学", "浙江社会科学", "探索与争鸣", "人文杂志", "社会科学辑刊", "东岳论丛",
  "广东社会科学", "学习与实践", "学海", "社会科学研究", "天津社会科学", "江汉论坛", "中州学刊",
  "河北学刊", "江西社会科学", "学术研究", "贵州社会科学", "云南社会科学", "甘肃社会科学",
  "宁夏社会科学", "内蒙古社会科学", "新疆社会科学", "青海社会科学", "民族研究", "中国行政管理",
  "公共管理学报", "公共行政评论", "北京行政学院学报", "上海行政学院学报", "法学研究", "中国法学",
  "法学家", "法律科学(西北政法大学学报)", "现代法学", "政法论坛", "比较法研究", "文史哲", "文学评论",
  "文艺研究", "外国文学评论", "外国语(上海外国语大学学报)", "外语界", "外语教学与研究", "中国语文",
  "世界汉语教学", "语言教学与研究", "当代语言学", "体育科学", "北京体育大学学报", "上海体育学院学报",
  "武汉体育学院学报", "天津体育学院学报", "成都体育学院学报", "西安体育学院学报"
];

export const PKU_CORE_JOURNALS: string[] = [
  "经济与管理", "企业经济", "商业经济研究", "现代营销", "营销界", "时代经贸", "商业观察",
  "中小企业管理与科技", "中国市场", "商场现代化", "中国商论", "商业经济", "北方经贸", "经济论坛",
  "经济纵横", "经济问题", "经济问题探索", "当代经济管理", "区域经济评论", "南方经济",
  "技术经济", "技术经济与管理研究", "工业技术经济", "企业改革与管理", "经营与管理", "物流科技",
  "物流技术", "中国物流与采购", "物流工程与管理", "电子商务", "中国电子商务", "电子商务评论",
  "江苏商论", "浙江工商大学学报", "首都经济贸易大学学报", "哈尔滨学院学报", "东华理工大学学报(社会科学版)",
  "新媒体与社会", "北京理工大学学报(社会科学版)", "现代情报", "图书馆学研究", "图书馆论坛",
  "大学图书馆学报", "图书馆工作与研究", "图书馆建设", "情报杂志", "情报探索", "河南社会科学",
  "湖南社会科学", "湖北社会科学", "广西社会科学", "山西财经大学学报", "财经问题研究", "财经论丛",
  "金融与经济", "金融理论与实践", "金融发展研究", "南方金融", "上海金融", "新金融", "西南金融",
  "经济经纬", "开发研究", "调研世界", "统计与决策", "统计与信息论坛", "数理统计与管理", "中国统计",
  "中国人力资源开发", "人口与发展", "教育与职业", "中国职业技术教育", "职教论坛", "教育与教学研究",
  "教学与管理", "课程·教材·教法", "上海教育科研", "教育理论与实践", "教学研究", "现代教育管理",
  "黑龙江高教研究", "高教发展与评估", "江苏高教", "高教探索", "学位与研究生教育", "研究生教育研究",
  "中国大学教学", "大学教育科学", "当代教育科学"
];

export const SCI_SSCI_JOURNALS: string[] = [
  "Journal of Retailing and Consumer Services", "International Journal of Contemporary Hospitality Management",
  "Journal of Consumer Research", "Journal of Marketing", "Journal of Marketing Research",
  "Journal of Business Research", "Journal of Interactive Marketing", "Journal of Advertising",
  "Journal of Retailing", "Journal of the Academy of Marketing Science", "Marketing Science",
  "Management Science", "Information Systems Research", "MIS Quarterly",
  "Computers in Human Behavior", "Electronic Commerce Research and Applications", "Internet Research",
  "Journal of Interactive Advertising", "Telematics and Informatics",
  "Technological Forecasting and Social Change", "International Journal of Information Management",
  "Information & Management", "Psychology & Marketing", "Journal of Consumer Behaviour",
  "International Journal of Electronic Commerce", "Journal of Computer-Mediated Communication",
  "Cyberpsychology Behavior and Social Networking", "New Media & Society", "Communication Research",
  "Journal of Advertising Research", "International Journal of Advertising", "Journal of Consumer Psychology",
  "Journal of Consumer Affairs", "Journal of the Association for Information Systems",
  "Decision Support Systems", "Electronic Markets", "International Journal of Human-Computer Studies",
  "Computers & Education", "Educational Technology & Society", "Tourism Management",
  "Annals of Tourism Research", "Journal of Travel Research", "International Journal of Hospitality Management",
  "Cornell Hospitality Quarterly", "International Journal of Production Economics",
  "Journal of Operations Management", "Production and Operations Management",
  "European Journal of Operational Research", "Omega", "Expert Systems with Applications",
  "Journal of Business Ethics", "Business Strategy and the Environment", "Journal of Cleaner Production",
  "Sustainable Production and Consumption", "Technovation", "Research Policy", "R&D Management",
  "Journal of Management Information Systems", "Information Processing & Management",
  "Government Information Quarterly", "Telecommunications Policy", "Information Technology & People",
  "Behaviour & Information Technology"
];

export interface JournalRankLists {
  csci: string[];
  pku: string[];
  sciSsi: string[];
}

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^0-9a-z一-龥]/g, "");

let merged: JournalRankLists | null = null;
export function setJournalRankLists(extra: Partial<JournalRankLists> | null): void {
  merged = {
    csci: [...CSSCI_JOURNALS, ...(extra?.csci ?? [])],
    pku: [...PKU_CORE_JOURNALS, ...(extra?.pku ?? [])],
    sciSsi: [...SCI_SSCI_JOURNALS, ...(extra?.sciSsi ?? [])],
  };
}
function lists(): JournalRankLists {
  if (!merged) setJournalRankLists(null);
  return merged as JournalRankLists;
}

/** 刊名 → 等级标记：CSSCI / 北大核心 / SCI/SSCI / 普通（未命中清单）。多个同时命中用「 / 」连接。 */
export function rankJournal(venue: string, cnkiCoreBadge?: string): string {
  const v = norm(venue);
  if (!v) return "未标定";
  const marks: string[] = [];
  if (cnkiCoreBadge && /北大|核心|CSSCI|AMI/i.test(String(cnkiCoreBadge))) marks.push(String(cnkiCoreBadge).trim());
  const L = lists();
  if (L.csci.some((j) => norm(j) === v) && !marks.includes("CSSCI")) marks.push("CSSCI");
  if (L.pku.some((j) => norm(j) === v) && !marks.includes("北大核心")) marks.push("北大核心");
  if (L.sciSsi.some((j) => norm(j) === v) && !marks.includes("SCI/SSCI")) marks.push("SCI/SSCI");
  return marks.length > 0 ? [...new Set(marks)].join(" / ") : "普通";
}
