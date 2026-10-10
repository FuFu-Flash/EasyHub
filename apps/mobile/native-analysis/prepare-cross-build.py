#!/usr/bin/env python3
"""Create a Meson cross file without shell-interpolating directory names."""
import pathlib
import sys

work, toolchain, pkg_config = map(pathlib.Path, sys.argv[1:])

def quoted(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"

(work / "android-arm64.ini").write_text(f"""[binaries]
c = {quoted(toolchain / 'bin/aarch64-linux-android24-clang')}
cpp = {quoted(toolchain / 'bin/aarch64-linux-android24-clang++')}
ar = {quoted(toolchain / 'bin/llvm-ar')}
strip = {quoted(toolchain / 'bin/llvm-strip')}
pkg-config = {quoted(pkg_config)}
[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'armv8-a'
endian = 'little'
[properties]
sys_root = {quoted(work / 'install')}
pkg_config_libdir = [{quoted(work / 'install/usr/local/lib/pkgconfig')}]
needs_exe_wrapper = true
[built-in options]
c_args = ['-Oz', '-fPIC', '-DNDEBUG']
cpp_args = ['-Oz', '-fPIC', '-DNDEBUG']
c_link_args = ['-Wl,-z,max-page-size=16384']
cpp_link_args = ['-Wl,-z,max-page-size=16384']
""")
