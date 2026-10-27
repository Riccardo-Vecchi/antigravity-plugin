#!/usr/bin/python3
"""Invalidate GNOME's live icon cache through an identical inherited theme."""
import json
import os
from pathlib import Path
import re
import time
import sys
from gi.repository import Gio

ALIAS='AntigravityLocalIconRefresh'
BASE=Path.home()/'.config/antigravity-project-appearance'
RECEIPT=BASE/'icon-refresh.json'
THEME=Path.home()/'.local/share/icons'/ALIAS
settings=Gio.Settings.new('org.gnome.desktop.interface')

def restore_interrupted():
    if not RECEIPT.exists():
        return
    record=json.loads(RECEIPT.read_text())
    name=record.get('original')
    if record.get('version')!=1 or not isinstance(name,str) or not re.fullmatch(r'[\w .+-]{1,128}',name) or name==ALIAS:
        raise ValueError('Invalid interrupted icon refresh record')
    if settings.get_string('icon-theme')==ALIAS:
        if not settings.set_string('icon-theme',name):
            raise RuntimeError('Could not restore the original icon theme')
        Gio.Settings.sync()
    RECEIPT.unlink(missing_ok=True)

restore_interrupted()
if '--recover-only' in sys.argv:
    print(json.dumps({'recovered':True,'currentTheme':settings.get_string('icon-theme')}))
    raise SystemExit(0)
original=settings.get_string('icon-theme')
if not re.fullmatch(r'[\w .+-]{1,128}',original) or original==ALIAS:
    raise ValueError('Unsupported icon theme name')
if not settings.is_writable('icon-theme'):
    raise RuntimeError('The icon theme setting is read-only')
THEME.mkdir(parents=True,exist_ok=True)
(THEME/'scalable/apps').mkdir(parents=True,exist_ok=True)
index=f'''[Icon Theme]
Name=Antigravity icon cache refresh
Comment=Temporary cache refresh; inherits the current desktop icon theme unchanged
Inherits={original}
Directories=scalable/apps

[scalable/apps]
Size=48
MinSize=8
MaxSize=512
Context=Applications
Type=Scalable
'''
(THEME/'index.theme').write_text(index)
BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
fd=os.open(RECEIPT,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as stream:
    json.dump({'version':1,'original':original},stream)
    stream.flush()
    os.fsync(stream.fileno())
try:
    if not settings.set_string('icon-theme',ALIAS):
        raise RuntimeError('Could not refresh the live icon theme')
    Gio.Settings.sync()
    time.sleep(0.35)
finally:
    # Preserve a theme change made by the user while this refresh was running.
    if settings.get_string('icon-theme')==ALIAS:
        if not settings.set_string('icon-theme',original):
            raise RuntimeError('Could not restore the original icon theme; recovery record retained')
        Gio.Settings.sync()
    RECEIPT.unlink(missing_ok=True)
print(json.dumps({'refreshed':True,'originalTheme':original,'currentTheme':settings.get_string('icon-theme')}))
