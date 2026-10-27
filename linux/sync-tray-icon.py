#!/usr/bin/python3
"""Set Antigravity's icon through supported GNOME/Zorin AppIndicator preferences."""
import json
import os
from pathlib import Path
import re
import sys
from gi.repository import Gio, GLib

if len(sys.argv) != 2 or sys.argv[1] not in ('antigravity', 'gemini', '--restore'):
    raise SystemExit('Choose antigravity, gemini, or --restore')
choice = sys.argv[1]
base = Path(__file__).resolve().parent.parent
storage = Path.home() / '.config/antigravity-project-appearance'
receipt = storage / 'tray-settings-original.json'
source = Gio.SettingsSchemaSource.get_default()
schema = next((name for name in ('org.gnome.shell.extensions.zorin-appindicator',
                                 'org.gnome.shell.extensions.appindicator')
               if source and source.lookup(name, True)), None)
if not schema:
    print(json.dumps({'available': False, 'changed': False})); raise SystemExit(0)
settings = Gio.Settings.new(schema)
if not settings.is_writable('custom-icons'):
    print(json.dumps({'available': False, 'changed': False})); raise SystemExit(0)
rows = list(settings.get_value('custom-icons').unpack())
original = json.loads(receipt.read_text()) if receipt.exists() else {'version': 1, 'schema': schema, 'entries': {}}
if original.get('version') != 1 or original.get('schema') != schema:
    raise ValueError('Unsupported tray preference backup')

if choice == '--restore':
    result = list(rows)
    for key, old in original['entries'].items():
        current = [row for row in result if row[0] == key]
        if current and all(str(row[1]).startswith(str(base / 'icons') + '/') for row in current):
            result = [row for row in result if row[0] != key] + old
    if result != rows:
        settings.set_value('custom-icons', GLib.Variant('a(sss)', result)); Gio.Settings.sync()
    print(json.dumps({'available': True, 'changed': result != rows})); raise SystemExit(0)

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
def call(service, obj, interface, method, signature, args):
    return bus.call_sync(service, obj, interface, method, GLib.Variant(signature, args), None,
                         Gio.DBusCallFlags.NONE, 1500, None).unpack()
try:
    entries = call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
                   'org.freedesktop.DBus.Properties', 'Get', '(ss)',
                   ('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'))[0]
except GLib.Error:
    print(json.dumps({'available': False, 'changed': False})); raise SystemExit(0)
ids = set()
for entry in entries:
    if '@' in entry: service, obj = entry.split('@', 1)
    elif '/' in entry: service, rest = entry.split('/', 1); obj = '/' + rest
    else: service, obj = entry, '/StatusNotifierItem'
    try:
        props = call(service, obj, 'org.freedesktop.DBus.Properties', 'GetAll', '(s)',
                     ('org.kde.StatusNotifierItem',))[0]
        key = str(props.get('Id', ''))
        if re.fullmatch(r'Antigravity_status_icon_\d+', key): ids.add(key)
    except GLib.Error:
        continue
if not ids:
    print(json.dumps({'available': False, 'changed': False})); raise SystemExit(0)
for key in ids:
    if key not in original['entries']: original['entries'][key] = [row for row in rows if row[0] == key]
storage.mkdir(parents=True, mode=0o700, exist_ok=True)
temporary = receipt.with_suffix('.tmp')
fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump(original, stream); stream.flush(); os.fsync(stream.fileno())
os.replace(temporary, receipt)
image = base / 'icons' / ('gemini-512.png' if choice == 'gemini' else 'antigravity.png')
if not image.is_file(): raise ValueError('Missing application icon')
result = [row for row in rows if row[0] not in ids]
result += [(key, str(image), '') for key in sorted(ids)]
if result != rows:
    if not settings.set_value('custom-icons', GLib.Variant('a(sss)', result)):
        raise RuntimeError('Could not update the tray icon')
    Gio.Settings.sync()
print(json.dumps({'available': True, 'changed': result != rows}))
