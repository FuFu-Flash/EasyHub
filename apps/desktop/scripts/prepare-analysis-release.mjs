import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Produces local release metadata only; publishing is a separate explicit operation.
const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(desktop, 'out', 'analysis-components');
const tag = 'analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1';
const target = process.argv[2];
if (!target || !/^[a-f0-9]{40}$/.test(target) || process.argv.length !== 3) throw new Error('Pass the verified remote commit SHA as the sole argument.');
const inputs = [
  { file: 'easyhub-ghidra-12.1.2-win-x64-v1.zip', size: 227541919, sha256: 'd1ce26e78f72b7dd5657d46ca2e40c13f17a658b7d0883a873a3c968ca797206' },
  { file: 'easyhub-java-21.0.12.1-win-x64-v1.zip', size: 49054730, sha256: '7a19729d199a7a253b56206fcfcd5c770d88054fd0baedcf2024c6d34e3336b1' },
  { file: 'upstream-source/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz', size: 115126841, sha256: '573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234' },
];
const assets = [];
for (const input of inputs) {
  const file = join(output, input.file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const size = (await stat(file)).size;
  const sha256 = hash.digest('hex');
  if (size !== input.size || sha256 !== input.sha256) throw new Error(`Prepared asset changed: ${input.file}`);
  assets.push({ name: input.file.split('/').at(-1), size, sha256 });
}
const manifest = { schema: 1, tag, platform: 'win32', arch: 'x64', downloadBytes: 277324769, assets,
  extension: { repository: 'bethington/ghidra-mcp', tag: 'v6.0.0', name: 'GhidraMCP-6.0.0.zip', size: 728120,
    sha256: '867731de27d5143632a010943b907a6485dd54d0e19729e2f85ee9f692c99873' },
  ghidraUpstreamSha256: 'b62e81a0390618466c019c60d8c2f796ced2509c4c1aea4a37644a77272cf99d',
  javaUpstreamSha256: 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e',
  preserved: { processors: 39, functionIdentificationDataBytes: 204144640, javaModules: 31 },
  verification: { sample: 'whoami.exe (read as data)', functions: 338, decompilation: true, cancellation: true, sampleUnchanged: true } };
await writeFile(join(output, 'analysis-component-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const body = [
  '供 EasyHub 的“设置 → 程序文件分析”自动安装。首次需要时下载，安装后可在本机分析程序文件。',
  '首次安装总下载约 264 MiB，较原完整组件约 743 MiB 减少 64%。保留处理器、格式分析数据、函数识别数据库及反编译所需内容，已完成真实程序分析和取消验收。',
  '组件版本：Ghidra 12.1.2、Java 21.0.12.1+1；扩展继续使用上游 Ghidra MCP 6.0.0 固定资产。',
  '许可证和来源说明随精简包提供。Java 对应的完整源代码单独提供在附件中，不参与应用的自动组件安装下载。精简准备脚本和固定资产校验清单一并附上。',
].join('\n\n');
await writeFile(join(output, 'component-release.json'), JSON.stringify({ tag_name: tag, target_commitish: target,
  name: 'EasyHub 程序分析精简组件', body, draft: true, prerelease: true, make_latest: 'false' }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ tag, downloadBytes: manifest.downloadBytes, assets }, null, 2) + '\n');
