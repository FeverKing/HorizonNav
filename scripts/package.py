#!/usr/bin/env python3
"""Build portable release folders. Runtime has no Node/Python/Go dependency."""
import argparse, os, pathlib, shutil, subprocess, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--out', default=str(root.parent / 'horizon-nav-packages'))
parser.add_argument('--targets', nargs='+', default=['windows-amd64', 'darwin-arm64', 'linux-amd64'])
args = parser.parse_args()
out = pathlib.Path(args.out).resolve()
subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'build'], cwd=root, check=True)
for target in args.targets:
    system, arch = target.split('-')
    if system not in ('windows','darwin','linux') or arch not in ('amd64','arm64'):
        raise SystemExit('Unsupported target: '+target)
    folder = out / ('fh6map-'+target)
    folder.mkdir(parents=True, exist_ok=True)
    binary = 'fh6map.exe' if system == 'windows' else 'fh6map'
    env = dict(os.environ, GOOS=system, GOARCH=arch, CGO_ENABLED='0')
    subprocess.run(['go','build','-trimpath','-ldflags=-s -w','-o',str(folder/binary),'.'],cwd=root,env=env,check=True)
    for directory in ['dist','data']:
        if (folder/directory).exists(): shutil.rmtree(folder/directory)
        shutil.copytree(root/directory,folder/directory)
    shutil.copytree(root/'docs/licenses',folder/'dist/licenses',dirs_exist_ok=True)
    shutil.copy2(root/'config.yaml',folder/'config.yaml')
    shutil.copy2(root/'docs/PORTABLE.md',folder/'使用说明.md')
    archive = out / (folder.name+'.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for item in sorted(folder.rglob('*')):
            if item.is_file(): z.write(item,pathlib.Path(folder.name)/item.relative_to(folder))
    print(archive, '%.1f MB' % (archive.stat().st_size/1e6))
