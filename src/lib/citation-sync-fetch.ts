export default function disabledSyncFetch(): never {
  throw new Error('引用导入只解析文件中的 BibTeX / RIS 内容。网络元数据请使用 DOI 补全。')
}
