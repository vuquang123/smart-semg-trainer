#!/usr/bin/env python3
"""Native regression checks. Run from the project root with Python 3 + GCC."""
import os
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
os.chdir(root)
Path('validation').mkdir(exist_ok=True)
cc=os.environ.get('CC','gcc')
base=[cc,'-std=c11','-O1','-g','-Wall','-Wextra','-Werror','-Wformat=2','-I','main','-I','main/tinyjambu','-I','main/tinyjambu/backend']
if os.name=='nt': base+=['-D__USE_MINGW_ANSI_STDIO=1']
core=['main/config.c','main/engine.c','main/source.c','main/protocol.c','main/replay_data.c','main/emg_adc.c','main/ws_aead.c','main/tinyjambu/tinyjambu-128-aead.c','main/tinyjambu/backend/tinyjambu-aead-common-128.c','main/tinyjambu/backend/tinyjambu-128-c32.c','main/tinyjambu/backend/tinyjambu-util.c']
sanitize=['-fsanitize=address,undefined','-fno-omit-frame-pointer'] if os.name!='nt' else []
env=dict(os.environ,ASAN_OPTIONS='detect_leaks=0')
commands=[
 ('test_features',base+['tests/test_features.c']+core+['-lm','-o','validation/test_features']),
 ('test_sync',base+sanitize+['-DEMG_UI_HOST_TEST','tests/test_sync.c','main/emg_ui.c','main/oled_view.c']+core+['-lm','-o','validation/test_sync']),
 ('test_ssd1306',base+sanitize+['-I','tests/stubs','tests/test_ssd1306.c','main/oled_view.c','main/config.c','-lm','-o','validation/test_ssd1306']),
 ('test_core',base+['tests/test_core.c']+core+['-lm','-o','validation/test_core']),
]
for name,command in commands:
    subprocess.run(command,check=True)
    result=subprocess.run([str(root/'validation'/name)],env=env,check=True,capture_output=True,text=True,encoding='utf-8')
    Path('validation',name+'.txt').write_text(result.stdout,encoding='utf-8')
    print(name,'PASS')
print('All Web + OLED native firmware checks: PASS')
