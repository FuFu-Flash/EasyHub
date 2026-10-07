#!/usr/bin/env python3
"""Create and verify a Mac ARM64 headless component image from the cached official ZIP.

No network requests, application changes, or sample-dependent processor removal.
The image is for optional general static analysis; it is not a full GUI distribution.
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import time
import unicodedata
import zipfile
import zlib

VERSION = '12.1.2'
SOURCE_NAME = 'ghidra_12.1.2_PUBLIC_20260605.zip'
SOURCE_BYTES = 572803866
SOURCE_SHA256 = 'b62e81a0390618466c019c60d8c2f796ced2509c4c1aea4a37644a77272cf99d'
SOURCE_URL = 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.2_build/' + SOURCE_NAME
ARCHIVE_ROOT = 'ghidra_12.1.2_PUBLIC/'
IMAGE_NAME = 'ghidra-12.1.2-mac-arm64-v1'
ZIP_NAME = 'easyhub-' + IMAGE_NAME + '.zip'
ZIP_DATE = (2026, 6, 5, 0, 0, 0)
NOTICE_SHA256 = 'ad4b2bb6e75e908251226180081b5afa01c7161d7710e08b603d0c340a08a23f'
UPSTREAM_NOTICE = """Ghidra

This product includes software developed at National Security Agency
(https://www.nsa.gov)

Portions of this product were created by the U.S. Government and not subject to
U.S. copyright protections under 17 U.S.C.

The remaining portions are copyright their respective authors and have been
contributed under the terms of one or more open source licenses, and made
available to you under the terms of those licenses. (See LICENSE)



Licensing Intent

The intent is that this software and documentation ("Project") should be treated
as if it is licensed under the license associated with the Project ("License")
in the LICENSE file. However, because we are part of the United States (U.S.)
Federal Government, it is not that simple.

The portions of this Project written by U.S. Federal Government employees within
the scope of their federal employment are ineligible for copyright protection in
the U.S.; this is generally understood to mean that these portions of the
Project are placed in the public domain.

In countries where copyright protection is available (which does not include the
U.S.), contributions made by U.S. Federal Government employees are released
under the License. Merged contributions from private contributors are released
under the License.

The Ghidra software is released under the Apache License, Version 2.0
("Apache 2.0").

In addition, each module may contain numerous 3rd party components (libraries,
icons, etc.) that each have their own license which is compatible with Apache
2.0. Each module has a LICENSE.txt file that lists each license used in that
module and the 3rd party files that fall under that license. The license files
for each license used by Ghidra can be found in the licenses directory at the
installation root.

Also, in the GPL directory, there are several stand-alone support programs that
are released using the GPL 3 license.  Ghidra executes these programs as needed
and parses the output to get the desired results. There is a licenses directory
under the GPL directory that has the GPL license files.

Consistent with the inbound=outbound model, contributions to any module must be
made available, by the contributor, under the applicable license(s). Please read
the Legal section of the CONTRIBUTING.md guide.
"""

SUPPORT_FILES = {'analyzeHeadless', 'launch.sh', 'launch.properties',
                 'LaunchSupport.jar', 'debug.log4j.xml', 'sleigh'}
LEGAL_PATH = re.compile(r'(^|/)(licenses?|legal)(/|$)|(^|/)(LICENSE|NOTICE|COPYING|COPYRIGHT)([^/]*)(/|$)', re.I)
MODULE_PATH = re.compile(r'^Ghidra/(Framework|Features|Processors)/[^/]+/(.+)$')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def legal(path):
    return bool(LEGAL_PATH.search(path))


def retention_rule(path):
    # Legal notices take precedence, even within an otherwise excluded tree.
    if legal(path):
        return 'legal'
    if path in ('bom.json', 'Ghidra/application.properties'):
        return 'metadata'
    if path.startswith('GPL/'):
        native = re.search(r'/os/([^/]+)/', path)
        if native and native.group(1) != 'mac_arm_64':
            return None
        return 'GPL tools and complete corresponding source'
    if path.startswith('Ghidra/Configurations/'):
        return 'configuration'
    if path.startswith('support/') and path[len('support/'):] in SUPPORT_FILES:
        return 'headless launcher'
    module = MODULE_PATH.match(path)
    if not module:
        return None
    member = module.group(2)
    if member == 'Module.manifest':
        return 'module metadata'
    if re.fullmatch(r'lib/[^/]+\.jar', member, re.I):
        return 'runtime JAR'
    if member.startswith('data/'):
        if path.startswith('Ghidra/Features/GhidraServer/data/yajsw'):
            return None
        return 'complete analysis data'
    if member.startswith('os/mac_arm_64/'):
        return 'Mac ARM64 native runtime'
    return None


def safe_member(info):
    require(info.filename.startswith(ARCHIVE_ROOT), 'Unexpected archive root: ' + info.filename)
    path = info.filename[len(ARCHIVE_ROOT):]
    if info.is_dir():
        path = path.rstrip('/')
    if not path:
        require(info.is_dir(), 'Empty archive filename')
        return None
    parts = path.split('/')
    require(not path.startswith('/') and not re.search(r'[\\:\x00]', path)
            and all(part not in ('', '.', '..') for part in parts), 'Unsafe member: ' + path)
    require(str(PurePosixPath(path)) == path, 'Noncanonical member: ' + path)
    file_type = stat.S_IFMT(info.external_attr >> 16)
    require(file_type in (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG),
            'Symbolic link or special member rejected: ' + path)
    require(not info.flag_bits & 1, 'Encrypted member rejected: ' + path)
    return path


def sha_stream(stream):
    result = hashlib.sha256()
    for data in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(data)
    return result.hexdigest()


def make_zip(path, image, files, modes):
    # Public zipfile APIs, fixed UTC-labelled DOS date, canonical Unix modes,
    # sorted names, no host paths, owner IDs, filesystem timestamps or comments.
    with zipfile.ZipFile(path, 'x', compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=True) as output:
        for member in files:
            info = zipfile.ZipInfo(IMAGE_NAME + '/' + member, date_time=ZIP_DATE)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | modes[member]) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, (image / member).read_bytes(),
                            compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True, help='Absolute path to the complete checksum-pinned official ZIP')
    parser.add_argument('--runtime-root', type=Path, help='Optional absolute installed Ghidra/MCP root to validate; does not run analysis')
    parser.add_argument('--output', '--output-root', type=Path, dest='output', help='Absolute output directory (default: desktop/out/analysis-components)')
    args = parser.parse_args()
    for key in ('archive', 'runtime_root', 'output'):
        path = getattr(args, key)
        if path is not None and not path.is_absolute():
            parser.error('--' + key.replace('_', '-') + ' requires an absolute path')
    # Install this file in apps/desktop/scripts, like the Windows preparation scripts.
    desktop_root = Path(__file__).resolve().parents[1]
    out = args.output.resolve() if args.output else desktop_root / 'out/analysis-components'
    report_path = out / (IMAGE_NAME + '.build.json')
    image = out / IMAGE_NAME
    artifact = out / ZIP_NAME
    require(not any(os.path.lexists(path) for path in (image, artifact, report_path, Path(str(artifact) + '.sha256'))),
            'Refusing to replace an existing v1 artifact; preserve it or select another output directory.')
    if args.runtime_root:
        metadata = args.runtime_root / 'ghidra/Ghidra/application.properties'
        plugin = args.runtime_root / 'extension/lib/GhidraMCP-6.0.0.jar'
        require(metadata.is_file() and re.search(r'^application.version=12\.1\.2\s*$', metadata.read_text(), re.M),
                'Expected an installed Ghidra 12.1.2 runtime.')
        require(plugin.is_file() and plugin.stat().st_size == 739004
                and digest(plugin) == 'b652a23b433786ac2e51e650fb6020cfdbb8743db6f58f16531fcac010d13522',
                'Expected the fixed GhidraMCP 6.0.0 extension JAR.')
    require(args.archive.is_file() and args.archive.stat().st_size == SOURCE_BYTES,
            'Expected the complete checksum-pinned official ZIP.')
    started = time.monotonic()
    print('Checking complete official Ghidra ZIP SHA256...', flush=True)
    require(digest(args.archive) == SOURCE_SHA256, 'Official Ghidra archive SHA256 mismatch.')
    require(isinstance(UPSTREAM_NOTICE, str)
            and hashlib.sha256(UPSTREAM_NOTICE.encode()).hexdigest() == NOTICE_SHA256,
            'Embedded matching-tag NOTICE SHA256 mismatch.')
    out.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    # All writes stay in a fresh staging directory inside the explicit output root.
    stage = Path(tempfile.mkdtemp(prefix='ghidra-stage-mac-arm64-v1-', dir=out))
    staged_image = stage / IMAGE_NAME
    staged_image.mkdir(mode=0o755)
    inventory = []
    selected = []
    modes = {}
    seen = set()
    with zipfile.ZipFile(args.archive, 'r') as upstream:
        for info in upstream.infolist():
            path = safe_member(info)
            if path is None:
                continue
            key = unicodedata.normalize('NFC', path).casefold()
            require(key not in seen, 'Case or Unicode collision in archive: ' + path)
            seen.add(key)
            if info.is_dir():
                continue
            entry = {'path': path, 'bytes': info.file_size}
            inventory.append(entry)
            rule = retention_rule(path)
            if rule:
                mode = (info.external_attr >> 16) & 0o777
                require(mode != 0, 'Official file has no Unix permissions: ' + path)
                selected.append({**entry, 'rule': rule, 'mode': format(mode, '04o')})
                modes[path] = mode
        selected.sort(key=lambda entry: entry['path'])
        selected_names = {entry['path'] for entry in selected}
        processors = sorted({entry['path'].split('/')[2] for entry in inventory
                             if entry['path'].startswith('Ghidra/Processors/')})
        require(len(processors) == 39, 'Expected all 39 delivered processor modules.')
        must_keep = [entry for entry in inventory if
                     re.match(r'^Ghidra/(Processors/[^/]+/data/|Features/(Base|FunctionID)/data/)', entry['path'])
                     or (MODULE_PATH.match(entry['path']) and
                         (MODULE_PATH.match(entry['path']).group(2) == 'Module.manifest'
                          or re.fullmatch(r'lib/[^/]+\.jar', MODULE_PATH.match(entry['path']).group(2), re.I)))
                     or legal(entry['path']) or entry['path'].startswith('GPL/')
                     and not re.search(r'/os/(?!mac_arm_64/)[^/]+/', entry['path'])]
        require(all(entry['path'] in selected_names for entry in must_keep),
                'A processor, typeinfo, FID, runtime JAR, manifest, legal file or GPL source was removed.')
        fid = [entry for entry in selected if entry['path'].endswith('.fidbf')]
        require(len(fid) == 10, 'Expected all ten delivered FunctionID databases.')
        native = [entry for entry in selected if '/os/' in entry['path']
                  and entry['rule'] != 'legal' and not entry['path'].endswith('/os/readme.txt')]
        require(all('/os/mac_arm_64/' in entry['path'] for entry in native),
                'Native runtime for another platform survived selection.')
        required = {'support/' + name for name in SUPPORT_FILES}
        required.update(('Ghidra/Features/Decompiler/os/mac_arm_64/decompile',
                         'Ghidra/Features/Decompiler/os/mac_arm_64/sleigh',
                         'Ghidra/Features/FileFormats/os/mac_arm_64/lzfse',
                         'GPL/DemanglerGnu/os/mac_arm_64/demangler_gnu_v2_24',
                         'GPL/DemanglerGnu/os/mac_arm_64/demangler_gnu_v2_41'))
        require(required <= selected_names, 'A required Mac headless launcher or native tool was removed.')
        print(f"Extracting {len(selected)} unchanged official files ({sum(e['bytes'] for e in selected)} bytes)...", flush=True)
        for entry in selected:
            path = entry['path']
            target = staged_image / path
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            source_hash = hashlib.sha256()
            extracted = 0
            with upstream.open(ARCHIVE_ROOT + path, 'r') as source, target.open('xb') as destination:
                for data in iter(lambda: source.read(1024 * 1024), b''):
                    source_hash.update(data)
                    destination.write(data)
                    extracted += len(data)
            target.chmod(modes[path])
            require(extracted == entry['bytes'] and target.stat().st_size == entry['bytes'],
                    'Retained member size changed: ' + path)
            entry['sha256'] = source_hash.hexdigest()
            require(digest(target) == entry['sha256'], 'Extracted bytes differ from official stream: ' + path)
            require(stat.S_IMODE(target.stat().st_mode) == modes[path], 'Permissions changed: ' + path)
    retained_bytes = sum(entry['bytes'] for entry in selected)
    manifest = {
        'schemaVersion': 1, 'component': 'ghidra', 'componentVersion': '1',
        'ghidraVersion': VERSION, 'platform': 'darwin', 'architecture': 'arm64',
        'upstream': {'archive': SOURCE_NAME, 'bytes': SOURCE_BYTES, 'sha256': SOURCE_SHA256,
                     'url': SOURCE_URL, 'release': 'Ghidra_12.1.2_build'},
        'build': {'method': 'Selective official ZIP stream extraction, independent output SHA256 and Unix mode verification.',
                  'deterministicZipTimestamp': '2026-06-05T00:00:00Z', 'zipCompression': 'DEFLATE level 9'},
        'preserved': ['All Framework/Features/Processors runtime JARs and Module.manifest files',
                      'All 39 processor language datasets and all format/typeinfo resources',
                      'All ten FunctionID databases and common-symbol data',
                      'Mac ARM64 native decompiler, sleigh, lzfse and GNU demanglers',
                      'Headless launch support, configurations and application metadata',
                      'All legal material, original BOM, GPL tools and complete corresponding source'],
        'excluded': ['Debug modules except legal files', 'Standalone documentation and examples except legal files',
                     'User scripts, developer Java source ZIPs and extension installer ZIPs',
                     'Non-Mac-ARM64 native tools', 'PyGhidra Python packaging and wheels',
                     'BSim PostgreSQL binaries and GhidraServer YAJSW installer except legal files',
                     'Standalone GUI, database/server, Docker and debugger launchers'],
        'scope': 'General static import, analysis and decompilation. No sample-dependent processor or format reduction; not a full GUI/debugger/server distribution.',
        'upstreamFileCount': len(inventory), 'retainedFileCount': len(selected),
        'retainedUpstreamBytes': retained_bytes, 'processorCount': len(processors),
        'processors': processors, 'fidDatabaseCount': len(fid),
        'fidDatabaseBytes': sum(entry['bytes'] for entry in fid),
        'files': selected,
        'supplementalUpstreamFiles': [{'path': 'NOTICE', 'bytes': len(UPSTREAM_NOTICE.encode()),
                                      'sha256': NOTICE_SHA256,
                                      'url': 'https://raw.githubusercontent.com/NationalSecurityAgency/ghidra/Ghidra_12.1.2_build/NOTICE'}],
    }
    additions = {
        'NOTICE': UPSTREAM_NOTICE,
        'easyhub-component.json': json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        'EASYHUB_COMPONENT_NOTICE.txt': (
            'EasyHub optional static analysis research component\n'
            'Ghidra 12.1.2, macOS ARM64, repack version 1\n\n'
            'This reduced image is not an upstream release or a production application update.\n'
            'No retained official file has been modified. See easyhub-component.json for exact\n'
            'file selection, original stream hashes, permissions and excluded distribution material.\n'
            'All 39 processors, all type/format data and all ten FID databases are preserved.\n'
            'GPL tools retain their complete corresponding source and notices. The original BOM\n'
            'is unchanged and is legal provenance; the component manifest is the actual inventory.\n'
            'General static import and decompilation are retained; standalone GUI/debugger,\n'
            'Python wheels, user scripts and database/server installers are excluded.\n'
            'Official source: ' + SOURCE_URL + '\n'
            'Official archive SHA256: ' + SOURCE_SHA256 + '\n'
        ),
    }
    for path, data in additions.items():
        target = staged_image / path
        target.write_text(data, encoding='utf-8')
        target.chmod(0o644)
        modes[path] = 0o644
    packaged_files = sorted(entry['path'] for entry in selected) + sorted(additions)
    packaged_files.sort()
    require(sorted(str(path.relative_to(staged_image)) for path in staged_image.rglob('*') if path.is_file()) == packaged_files,
            'Unexpected extracted file in the research image.')
    staged_zip = stage / (IMAGE_NAME + '.zip')
    print('Compressing deterministic ZIP and independently recompressing it...', flush=True)
    make_zip(staged_zip, staged_image, packaged_files, modes)
    reproduction = stage / (IMAGE_NAME + '.reproduction.zip')
    make_zip(reproduction, staged_image, packaged_files, modes)
    archive_sha256 = digest(staged_zip)
    require(archive_sha256 == digest(reproduction), 'Deterministic ZIP reproduction failed.')
    expected_hashes = {entry['path']: entry['sha256'] for entry in selected}
    expected_hashes.update({path: hashlib.sha256(data.encode()).hexdigest() for path, data in additions.items()})
    print('Verifying every compressed member against the official stream proof...', flush=True)
    with zipfile.ZipFile(staged_zip, 'r') as zipped:
        require(zipped.namelist() == [IMAGE_NAME + '/' + path for path in packaged_files], 'Packaged member inventory changed.')
        for path in packaged_files:
            name = IMAGE_NAME + '/' + path
            info = zipped.getinfo(name)
            require(info.date_time == ZIP_DATE and (info.external_attr >> 16) == stat.S_IFREG | modes[path],
                    'Deterministic timestamp or permissions changed: ' + path)
            with zipped.open(name, 'r') as source:
                require(sha_stream(source) == expected_hashes[path], 'Packaged stream differs from official bytes: ' + path)
    for entry in selected:
        require(digest(staged_image / entry['path']) == entry['sha256'], 'Packaged source image was modified.')
    zip_bytes = staged_zip.stat().st_size
    unpacked_bytes = sum((staged_image / path).stat().st_size for path in packaged_files)
    result = {
        'status': 'prepared_and_verified', 'image': str(image), 'archive': str(artifact),
        'completedAt': datetime.now().astimezone().isoformat(),
        'source': {'archive': str(args.archive), 'bytes': SOURCE_BYTES, 'sha256': SOURCE_SHA256, 'url': SOURCE_URL},
        'version': VERSION, 'platform': 'darwin', 'architecture': 'arm64',
        'archiveBytes': zip_bytes, 'archiveSHA256': archive_sha256,
        'unpackedBytes': unpacked_bytes, 'retainedUpstreamBytes': retained_bytes,
        'upstreamUnpackedBytes': sum(entry['bytes'] for entry in inventory),
        'downloadReductionPercent': round((1 - zip_bytes / SOURCE_BYTES) * 100, 3),
        'unpackedReductionPercent': round((1 - unpacked_bytes / sum(entry['bytes'] for entry in inventory)) * 100, 3),
        'upstreamFileCount': len(inventory), 'retainedOfficialFileCount': len(selected), 'packagedFileCount': len(packaged_files),
        'processorCount': len(processors), 'processors': processors,
        'fidDatabaseCount': len(fid), 'fidDatabaseBytes': sum(entry['bytes'] for entry in fid),
        'retainedCategories': {rule: {'files': sum(entry['rule'] == rule for entry in selected),
                                     'bytes': sum(entry['bytes'] for entry in selected if entry['rule'] == rule)}
                               for rule in sorted({entry['rule'] for entry in selected})},
        'nativeRuntimePaths': [entry['path'] for entry in native],
        'legalFileCount': sum(legal(entry['path']) for entry in inventory),
        'gplSourceFiles': sum(entry['path'].startswith('GPL/') and '/src/' in entry['path'] for entry in selected),
        'manifestSHA256': digest(staged_image / 'easyhub-component.json'),
        'verification': {
            'completeOfficialArchiveSHA256': True, 'allArchivePathsAndMemberTypesSafe': True,
            'allRetainedFilesMatchOfficialStreams': True, 'allRetainedPermissionsMatchOfficialArchive': True,
            'allRuntimeJarsAndModuleManifestsRetained': True, 'allProcessorTypeFormatFidDataRetained': True,
            'allLegalFilesAndGplSourcesRetained': True, 'allPackagedStreamsMatchManifest': True,
            'deterministicZipReproduction': True, 'nativeRuntimeOnlyMacArm64': True,
            'headlessSupportComplete': True, 'matchingTagNoticeSHA256': NOTICE_SHA256,
            'realAnalysisExecutedByThisScript': False,
        },
        'zipTimestamp': '2026-06-05T00:00:00Z', 'zlibVersion': zlib.ZLIB_VERSION,
        'packagingElapsedSeconds': round(time.monotonic() - started, 3),
        'liveAnalysisComparison': 'Performed separately by the root agent with the slim Java runtime; packaging proof alone does not establish analysis equivalence.',
        'productionApplicationChanged': False, 'officialArchiveChanged': False, 'networkRequests': False,
    }
    staged_image.rename(image)
    staged_zip.rename(artifact)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    Path(str(artifact) + '.sha256').write_text(archive_sha256 + '  ' + ZIP_NAME + '\n', encoding='utf-8')
    # Delete only this invocation's staging directory (its reproducibility ZIP).
    shutil.rmtree(stage)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
