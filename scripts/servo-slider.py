"""USB slider for firmware 2.7. No movement on launch or connect.
Install pyserial, then run: pythonw scripts/servo-slider.py
"""
from pathlib import Path
import sys, json, time
import tkinter as tk
from tkinter import ttk
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'serial-runtime'))
import serial
from serial.tools import list_ports

STARTS = {'Choose your previous mode…': None, 'Power-on rest — 45°': 45,
          'Calm — 25°': 25, 'Pulse — 20°': 20, 'Energy — 15°': 15, 'Night — 35°': 35}

class Slider:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title('Wings On Hair — live endpoint slider')
        self.root.geometry('720x760'); self.root.minsize(680, 740)
        style = ttk.Style(); style.theme_use('clam')
        style.configure('.', font=('Segoe UI', 11), background='#f6f2f7')
        style.configure('TButton', padding=(12, 9))
        self.root.configure(bg='#f6f2f7')
        self.port = None; self.verified = False; self.armed = False
        self.buffer = ''; self.pending = None; self.last_send = self.last_ping = self.last_status = 0
        self.port_name = tk.StringVar(); self.mode = tk.StringVar(value=next(iter(STARTS)))
        self.end = tk.DoubleVar(value=45); self.value = tk.StringVar(value='—°')
        self.message = tk.StringVar(value='Motor signal off. Nothing moves automatically.')
        self.report = tk.StringVar(value='Select the old mode whose starting position worked.')
        panel = ttk.Frame(self.root, padding=26); panel.pack(fill='both', expand=True)
        ttk.Label(panel, text='Find a gentle endpoint', font=('Segoe UI', 23, 'bold')).pack(anchor='w')
        ttk.Label(panel, text='Keep the old start. Adjust only how far the wings flap.').pack(anchor='w', pady=(5, 18))
        ports = ttk.Frame(panel); ports.pack(fill='x')
        self.ports = ttk.Combobox(ports, textvariable=self.port_name, state='readonly', width=12); self.ports.pack(side='left')
        ttk.Button(ports, text='Refresh', command=self.refresh).pack(side='left', padx=8)
        self.connect_button = ttk.Button(ports, text='Connect USB', command=self.connect); self.connect_button.pack(side='left')
        ttk.Label(panel, textvariable=self.message, foreground='#9b3569', wraplength=650).pack(anchor='w', pady=15)
        ttk.Label(panel, text='1. Choose the starting position that worked before').pack(anchor='w')
        self.modes = ttk.Combobox(panel, textvariable=self.mode, values=list(STARTS), state='readonly')
        self.modes.pack(fill='x', pady=8); self.modes.bind('<<ComboboxSelected>>', self.changed_mode)
        self.enable = ttk.Button(panel, text='Move to this starting position', command=self.arm, state='disabled'); self.enable.pack(anchor='w')
        ttk.Label(panel, text='This first command sets an absolute servo position. Choose your old mode carefully.', wraplength=650).pack(anchor='w', pady=(6, 18))
        ttk.Label(panel, text='2. Move the end slider slowly, or use 1° steps').pack(anchor='w')
        ttk.Label(panel, textvariable=self.value, font=('Segoe UI', 30, 'bold'), foreground='#9b3569').pack(pady=(8, 0))
        self.scale = ttk.Scale(panel, variable=self.end, from_=15, to=110, command=self.slide, state='disabled'); self.scale.pack(fill='x', pady=8)
        step = ttk.Frame(panel); step.pack()
        self.minus = ttk.Button(step, text='− 1°', command=lambda: self.nudge(-1), state='disabled'); self.minus.pack(side='left', padx=6)
        self.plus = ttk.Button(step, text='+ 1°', command=lambda: self.nudge(1), state='disabled'); self.plus.pack(side='left', padx=6)
        actions = ttk.Frame(panel); actions.pack(fill='x', pady=15)
        self.rest = ttk.Button(actions, text='Return to start', command=lambda: self.move_once('REST'), state='disabled'); self.rest.pack(side='left')
        self.flap = ttk.Button(actions, text='One gentle flap', command=lambda: self.move_once(f'FLAP {round(self.end.get())}'), state='disabled'); self.flap.pack(side='left', padx=6)
        self.save = ttk.Button(actions, text='Save for all modes', command=self.save_range, state='disabled'); self.save.pack(side='right')
        tk.Button(panel, text='STOP — MOTOR SIGNAL OFF', command=self.stop, bg='#a02f50', fg='white', activebackground='#7f1939', activeforeground='white', font=('Segoe UI', 13, 'bold'), relief='flat', pady=12).pack(fill='x')
        ttk.Label(panel, textvariable=self.report, wraplength=650).pack(anchor='w', pady=(12, 0))
        self.root.protocol('WM_DELETE_WINDOW', self.close); self.root.bind('<Escape>', lambda _: self.stop())
        self.refresh(); self.root.after(50, self.poll)

    def refresh(self):
        ports = [p.device for p in list_ports.comports() if p.vid == 0x303a]
        self.ports['values'] = ports
        if self.port_name.get() not in ports: self.port_name.set(ports[0] if ports else '')

    def controls(self, armed):
        self.armed = armed
        if not armed: self.pending = None
        for widget in (self.scale, self.minus, self.plus, self.rest, self.flap): widget['state'] = 'normal' if armed else 'disabled'
        self.modes['state'] = 'disabled' if armed else 'readonly'
        self.enable['state'] = 'normal' if self.verified and not armed and STARTS[self.mode.get()] is not None else 'disabled'
        self.save['state'] = 'normal' if self.verified and STARTS[self.mode.get()] is not None else 'disabled'

    def send(self, command):
        if not self.port: return
        try: self.port.write((command + '\n').encode('ascii'))
        except Exception as error: self.disconnect(); self.message.set(str(error))

    def connect(self):
        if self.port: self.disconnect(); return
        try:
            if not self.port_name.get(): raise ValueError('Plug in the ESP32 and click Refresh.')
            self.port = serial.Serial(port=None, baudrate=115200, timeout=0, write_timeout=.3)
            self.port.port = self.port_name.get(); self.port.rts = False; self.port.dtr = True; self.port.open()
            self.buffer = ''; self.connected_at = time.monotonic(); self.verified = False
            self.send('STOP'); self.send('STATUS')
            self.connect_button['text'] = 'Disconnect'; self.message.set('Connected · checking manual-control firmware…')
        except Exception as error: self.disconnect(); self.message.set(str(error))

    def changed_mode(self, _=None):
        self.stop(); start = STARTS[self.mode.get()]
        if start is not None: self.scale.configure(from_=start, to=110); self.end.set(start); self.value.set(f'{start}°')
        self.controls(False)

    def arm(self):
        start = STARTS[self.mode.get()]
        if self.verified and start is not None:
            self.end.set(start); self.value.set(f'{start}°'); self.send(f'ARM {start}')

    def slide(self, value):
        angle = round(float(value)); self.value.set(f'{angle}°')
        if self.armed: self.pending = angle

    def nudge(self, amount):
        angle = max(STARTS[self.mode.get()], min(110, round(self.end.get()) + amount))
        self.end.set(angle); self.slide(str(angle))

    def stop(self):
        self.pending = None; self.send('STOP'); self.controls(False)
        self.report.set('Motor signal off. No automatic movement.')

    def move_once(self, command):
        self.pending = None
        if self.armed: self.send(command)

    def save_range(self):
        start = STARTS[self.mode.get()]; end = round(self.end.get())
        if start is None or start >= end: self.report.set('Choose an end angle above the start first.'); return
        self.stop(); self.send(f'SAVE {start} {end}')
        self.report.set('Waiting for the butterfly to confirm saving…')

    def disconnect(self):
        self.pending = None
        if self.port:
            try: self.port.write(b'STOP\n')
            except Exception: pass
            self.port.close()
        self.port = None; self.verified = False; self.controls(False)
        self.connect_button['text'] = 'Connect USB'; self.message.set('Disconnected · motor signal off')

    def poll(self):
        if self.port:
            try:
                self.buffer = (self.buffer + self.port.read_all().decode('ascii', errors='replace'))[-8192:]
                while '\n' in self.buffer:
                    line, self.buffer = self.buffer.split('\n', 1)
                    if line.startswith('SAFEUSB 1 '):
                        self.verified = True; self.message.set('Connected · manual control ready')
                        self.controls(line.startswith('SAFEUSB 1 ON ')); self.report.set(line.replace('SAFEUSB 1 ', 'Motor ').replace('COMMAND', 'Commanded angle'))
                    elif line.startswith('SAVED '):
                        _, first, last = line.split()
                        path = ROOT / '.tools' / 'chosen-wing-angles.json'; path.parent.mkdir(exist_ok=True)
                        path.write_text(json.dumps({'startAngle': int(first), 'endAngle': int(last), 'previousMode': self.mode.get()}, indent=2), encoding='utf-8')
                        self.message.set('Angles saved inside the butterfly · retained after restart')
                    elif line.startswith('ERROR'): self.report.set(line)
                now = time.monotonic()
                if now - self.last_ping > .25: self.last_ping = now; self.send('PING')
                if now - self.last_status > .5: self.last_status = now; self.send('STATUS')
                if self.armed and self.pending is not None and now - self.last_send >= .08:
                    self.send(f'END {self.pending}'); self.pending = None; self.last_send = now
                if not self.verified and now - self.connected_at > 3: self.report.set('Upload firmware 2.7 first. The old 90–100 test does not support this slider.')
            except Exception as error: self.disconnect(); self.message.set(f'USB disconnected · {error}')
        self.root.after(50, self.poll)

    def close(self): self.disconnect(); self.root.destroy()

if __name__ == '__main__':
    app = Slider()
    if '--smoke-test' in sys.argv: app.root.update(); app.close(); print('Slider window opens without connecting or moving the motor.')
    else: app.root.mainloop()
