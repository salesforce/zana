#!/usr/bin/env python3
"""Render the narrated Zana for Slack walkthrough, with Pi as the example harness."""
from pathlib import Path
from functools import lru_cache
import argparse
import asyncio
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import wave
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
KIT = OUT.parent / 'mobile-connect'
spec = importlib.util.spec_from_file_location('video_kit', KIT / 'render.py')
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
font, txt, wrap, rr = kit.font, kit.txt, kit.wrap, kit.rr
button, check, badge = kit.button, kit.check, kit.badge
add_shadow, ease, pulse, highlight = kit.add_shadow, kit.ease, kit.pulse, kit.highlight
W, H, FPS, DURATION = 1920, 1080, 24, 74
WHITE, MUTED, ACCENT, GREEN = '#f5f4ff', '#b5bad0', '#baa9ff', '#7ce4bd'
VOICE, VOICE_RATE = 'en-US-AvaMultilingualNeural', '-5%'
PANEL = (798, 206)

# Sample data only: no real workspace, org, Project, or person.
USER = 'Sam Rivera'
CHANNEL = 'sales-cloud-dev'
PROJECT = 'Sales Cloud App'
MODEL = 'anthropic/claude-sonnet-5-5'
ORG = 'my-dev-sandbox'
TASK = 'Fix the failing AccountService tests and summarize the change.'
FOLLOWUP = 'Now add a test for the bulk insert path.'

# Slack-like dark theme (illustrated, not a capture).
S_BG, S_SIDE, S_TOP, S_LINE = '#1a1d21', '#3f0e40', '#350d36', '#34363b'
S_INK, S_DIM, S_GREEN, S_BLUE = '#d1d2d3', '#9a9b9e', '#007a5a', '#1164a3'

SCENES = [
    (0, 5, 'intro', 'Zana, right\ninside Slack.', 'Start agents from Slack.\nThey run on your computer.'),
    (5, 17, 'launch', 'Just mention\n@Zana.', 'No form. The channel’s Project and\nharness are used. Here, Pi.'),
    (17, 30, 'work', 'Pi asks.\nYou answer.', 'Pi runs on your computer. Its\nquestions are answered in Slack.'),
    (30, 41, 'answer', 'Answers land\nin the thread.', 'When the turn ends, Zana replies\nin the same Slack thread.'),
    (41, 52, 'followup', 'Keep the\nthread going.', 'Reply in the thread. Same Project,\nmachine, harness, and model.'),
    (52, 64, 'private', 'Your private\nagent chat.', 'Message Zana directly.\nAsk for your unread reports.'),
    (64, 74, 'home', 'Your agents.\nWhere you work.', 'Follow, mute, or stop agents\nfrom Zana Home in Slack.'),
]
NARRATION = [
    (0.4, 4.7, 'Meet Zana for Slack, shown here with Pi.'),
    (5.4, 16.6, 'In a linked channel, just mention Zana with your task. Zana uses that channel’s Project and harness: Pi here, or any harness installed in Zana.'),
    (17.4, 29.6, 'Pi works on your own computer. When it needs a decision, it asks right in the Slack thread. Answer there, and Pi fixes the code and reruns the tests.'),
    (30.4, 40.6, 'When the turn ends, Zana posts the answer right back in your Slack thread: what changed, and how the tests did.'),
    (41.4, 51.6, 'Reply in the thread to keep going. Zana continues the same conversation, with the same Project, machine, and harness.'),
    (52.4, 63.6, 'Or message Zana privately. Ask for your unread reports, and it reads them straight from your Zana inbox.'),
    (64.4, 73.6, 'Zana Home lists every agent, so you can follow, mute, or stop them. Just keep your computer awake, with Zana running.'),
]


@lru_cache(None)
def logo(size):
    return Image.open(ROOT / 'website/public/zana-icon-512.png').convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)


def avatar(im, x, y, who, size=38):
    if who == 'zana':
        rr(im, (x, y, x+size, y+size), '#2c2d30', 8)
        im.alpha_composite(logo(size-6), (x+3, y+3))
    else:
        rr(im, (x, y, x+size, y+size), '#2f6f8f', 8)
        txt(im, (x+size/2, y+size/2), 'SR', int(size*.42), WHITE, True, anchor='mm')


def mention_pill(im, x, y, size=17):
    """Slack's blue @Zana chip, drawn over text already laid out at (x, y)."""
    w = ImageDraw.Draw(im).textlength('@Zana', font=font(size))
    rr(im, (x-3, y-1, x+w+3, y+size+6), '#1c3443', 4)
    txt(im, (x, y), '@Zana', size, '#5ab6e6')


def message(im, x, y, who, time, body, width=720, extra=None):
    """One Slack message; returns the y below it."""
    avatar(im, x, y+2, who)
    name = 'Zana' if who == 'zana' else USER
    txt(im, (x+52, y), name, 18, WHITE, True)
    nx = x+52+ImageDraw.Draw(im).textlength(name, font=font(18, True))+10
    if who == 'zana':
        rr(im, (nx, y+3, nx+38, y+21), '#3b3d42', 4)
        txt(im, (nx+19, y+12), 'APP', 12, S_DIM, True, anchor='mm')
        nx += 48
    txt(im, (nx, y+3), time, 14, S_DIM)
    top = y+28
    y = wrap(im, (x+52, top), body, width, 17, S_INK, gap=1.42) if body else top
    if body.startswith('@Zana'): mention_pill(im, x+52, top)
    if extra: y = extra(im, x+52, y)
    return y+14


def slack_frame(im, header, sub=None, active=CHANNEL):
    rr(im, (0, 0, 1039, 649), S_BG, 18, '#45474b', 2)
    d = ImageDraw.Draw(im)
    rr(im, (0, 0, 1039, 44), S_TOP, 18)
    d.rectangle((0, 24, 1039, 44), fill=S_TOP)
    for i, c in enumerate(['#ff6865', '#f5c14b', '#56c86a']):
        d.ellipse((20+i*22, 16, 31+i*22, 27), fill=c)
    rr(im, (330, 10, 710, 34), '#5a2e5b', 7)
    txt(im, (520, 22), 'Search Acme', 14, '#d8c9d8', anchor='mm')
    d.rectangle((0, 44, 210, 640), fill=S_SIDE)
    rr(im, (0, 600, 210, 649), S_SIDE, 18)
    txt(im, (18, 60), 'Acme', 20, WHITE, True)
    txt(im, (18, 104), 'Channels', 15, '#cfc3cf', True)
    for i, ch in enumerate(['general', CHANNEL, 'release-notes']):
        y = 134+i*32
        if ch == active: rr(im, (8, y-6, 202, y+22), S_BLUE, 6)
        txt(im, (22, y), f'#  {ch}', 15, WHITE if ch == active else '#cfc3cf')
    txt(im, (18, 248), 'Apps', 15, '#cfc3cf', True)
    y = 278
    if active == 'zana': rr(im, (8, y-6, 202, y+22), S_BLUE, 6)
    im.alpha_composite(logo(18), (22, y-1))
    txt(im, (48, y), 'Zana', 15, WHITE if active == 'zana' else '#cfc3cf')
    d.line((211, 44, 211, 649), fill=S_LINE)
    txt(im, (232, 60), header, 20, WHITE, True)
    if sub: txt(im, (232+d.textlength(header, font=font(20, True))+14, 64), sub, 14, S_DIM)
    d.line((211, 96, 1039, 96), fill=S_LINE)


def composer(im, text='', placeholder=f'Message #{CHANNEL}', top=566):
    rr(im, (228, top, 1020, top+62), '#222529', 9, '#565856')
    if text: txt(im, (246, top+20), text, 17, WHITE)
    else: txt(im, (246, top+20), placeholder, 17, '#7d7e81')
    if text.startswith('@Zana '): mention_pill(im, 246, top+20)
    rr(im, (972, top+14, 1006, top+48), S_GREEN if text else '#2c2e33', 6)
    ImageDraw.Draw(im).polygon([(983, top+22), (999, top+31), (983, top+40)], fill=WHITE if text else '#6d6f73')


BOXES = {}  # highlight targets recorded while drawing, keyed by state


def status(kind, text):
    """Threaded bot status, edited in place; drawn icons stand in for Slack's emoji."""
    color = {'queued': '#e8a33d', 'working': '#4aa3df', 'attention': '#f2a65a', 'done': '#2bac76'}[kind]

    def draw(im, x, y):
        d = ImageDraw.Draw(im)
        y -= 2
        if kind == 'attention':
            d.polygon([(x+10, y+3), (x+20, y+21), (x, y+21)], fill=color)
            txt(im, (x+10, y+15), '!', 12, S_BG, True, anchor='mm')
        elif kind == 'done':
            d.line([(x+2, y+12), (x+8, y+18), (x+19, y+5)], fill=color, width=3)
        else:
            d.ellipse((x, y+3, x+19, y+22), outline=color, width=3)
            if kind == 'queued': d.line([(x+9.5, y+7), (x+9.5, y+13), (x+14, y+16)], fill=color, width=2)
            else: d.ellipse((x+6, y+9, x+13, y+16), fill=color)
        return wrap(im, (x+30, y), text, 680, 17, S_INK, gap=1.42)
    return draw


def replies(count):
    def draw(im, x, y):
        txt(im, (x, y+2), count, 14, '#1d9bd1', True)
        txt(im, (x+ImageDraw.Draw(im).textlength(count, font=font(14, True))+10, y+2), 'Last reply just now', 14, S_DIM)
        return y+24
    return draw


MENTION = f'@Zana {TASK}'
# Exact copy from the bridge's question delivery and Answer Zana modal.
QUESTION = 'Three tests fail because the test Accounts have no Owner. How should I fix it?'
OPTIONS = ['Handle a missing Owner in AccountService', 'Give every test Account an Owner']
ASK_NOTE = 'Zana needs a preference or clarification. Execution permissions are reviewed in Zana.'
FORM_NOTE = 'Your answers become an ordinary follow-up to this same agent. This form cannot approve tool execution.'
WELCOME = 'Ask Zana about your reports or describe a task. I will use the connected Project when it is clear and ask when it is not. Tasks run on your configured Zana computer.'
ANSWER = 'Fixed the missing null check on Owner in AccountService.cls. Targeted tests: 12 of 12 passing in my-dev-sandbox. Nothing was deployed.'
ANSWER_SHORT = 'Fixed the null Owner check in AccountService.cls. 12 of 12 tests passing.'
ANSWER2 = 'Added testBulkInsert with 200 records to AccountServiceTest. 13 of 13 passing in my-dev-sandbox.'
REPORTS = ('You have 3 unread reports:\n'
           f'1. Nightly Apex test health — {PROJECT}, 2026-10-05 (unread)\n'
           '2. Dependency audit — Website, 2026-10-04 (unread)\n'
           '3. Weekly PR summary — Website, 2026-10-03 (unread)')


def shade_modal(im, box, title):
    im.alpha_composite(Image.new('RGBA', im.size, (0, 0, 0, 150)))
    x0, y0, x1, _ = box
    rr(im, box, '#222529', 12, '#4b4d52', 2)
    im.alpha_composite(logo(30), (x0+24, y0+18))
    txt(im, (x0+66, y0+22), title, 21, WHITE, True)
    txt(im, (x1-30, y0+22), '×', 24, S_DIM, anchor='ma')
    ImageDraw.Draw(im).line((x0+1, y0+64, x1-1, y0+64), fill='#3a3c41')


def app_tabs(im, active):
    rr(im, (296, 62, 362, 84), '#3c2f6b', 5)
    txt(im, (329, 73), 'AGENT', 13, ACCENT, True, anchor='mm')
    for tab, x in [('Messages', 400), ('Home', 500), ('About', 572)]:
        txt(im, (x, 64), tab, 15, WHITE if tab == active else S_DIM, tab == active)
    ImageDraw.Draw(im).line((400, 92, 474, 92) if active == 'Messages' else (500, 92, 545, 92), fill=WHITE, width=3)


def ask_actions(im, x, y):
    """The bridge's question delivery: context line, then one Answer questions button."""
    y = wrap(im, (x, y+2), ASK_NOTE, 720, 15, S_DIM, gap=1.35)
    w = int(ImageDraw.Draw(im).textlength('Answer questions', font=font(15, True)))+34
    button(im, (x, y+8, x+w, y+42), 'Answer questions', primary=False, dark=True, size=15)
    BOXES['_answer-btn'] = (x+w//2, y+25)
    return y+48


def answer_form(im, select_open, chosen):
    """Slack's Answer Zana modal: a choice per question or a free-text answer."""
    shade_modal(im, (230, 84, 820, 620), 'Answer Zana')
    d = ImageDraw.Draw(im)
    wrap(im, (254, 168), FORM_NOTE, 540, 15, S_INK, gap=1.4)
    y = wrap(im, (254, 232), QUESTION, 540, 15, WHITE, True, gap=1.35)
    rr(im, (254, y+10, 796, y+46), '#1a1d21', 6, '#1d9bd1' if select_open else '#5e6066', 2 if select_open else 1)
    txt(im, (268, y+19), OPTIONS[0] if chosen else 'Select an item', 16, S_INK if chosen else '#7d7e81')
    d.polygon([(774, y+25), (784, y+25), (779, y+32)], fill=S_DIM)
    BOXES['select'] = (525, y+28)
    select_bottom = y+46
    txt(im, (254, y+66), 'Or write your own answer', 15, WHITE, True)
    txt(im, (254+d.textlength('Or write your own answer', font=font(15, True))+6, y+67), '(optional)', 14, S_DIM)
    rr(im, (254, y+90, 796, y+126), '#1a1d21', 6, '#5e6066')
    d.line((231, 548, 819, 548), fill='#3a3c41')
    button(im, (562, 566, 658, 602), 'Cancel', primary=False, dark=True, size=16)
    button(im, (668, 566, 796, 602), 'Send answers', size=16, accent=S_GREEN)
    BOXES['send'] = (732, 584)
    if select_open:
        rr(im, (254, select_bottom+6, 796, select_bottom+86), '#2b2d31', 8, '#5e6066')
        for i, option in enumerate(OPTIONS):
            oy = select_bottom+14+i*34
            if i == 0: rr(im, (262, oy-4, 788, oy+28), S_BLUE, 5)
            txt(im, (276, oy+3), option, 16, WHITE if i == 0 else S_INK)
        BOXES['option'] = (525, select_bottom+26)


THREAD = ('thread', 'asked', 'answering', 'answering-open', 'answering-chosen', 'resumed', 'answered',
          'reply', 'reply-working', 'reply-done')


@lru_cache(None)
def slack(state='channel', typed=0):
    im = Image.new('RGBA', (1040, 650))
    if state in ('channel', 'mentioned', 'mentioned-reply'):
        slack_frame(im, f'#  {CHANNEL}', f'{PROJECT} · connected to Zana')
        y = message(im, 232, 116, 'user', '10:31 AM', 'Morning! The nightly run flagged AccountServiceTest again.')
        if state != 'channel':
            top, y = y, message(im, 232, y, 'user', '10:42 AM', MENTION,
                                extra=replies('1 reply') if state == 'mentioned-reply' else None)
            BOXES['reply-link'] = (278, y-44, 400, y-16)
        composer(im, MENTION[:typed] if state == 'channel' else '')
        if 0 < typed < 6 and state == 'channel':
            rr(im, (228, 470, 700, 556), '#222529', 9, '#45474b')
            txt(im, (246, 482), 'People and apps', 13, S_DIM, True)
            rr(im, (236, 506, 692, 548), S_BLUE, 6)
            avatar(im, 246, 510, 'zana', 34)
            txt(im, (292, 517), 'Zana', 17, WHITE, True)
            rr(im, (342, 519, 378, 535), '#3b5d86', 4)
            txt(im, (360, 527), 'APP', 11, WHITE, True, anchor='mm')
            txt(im, (390, 518), 'Start agents and check activity', 15, '#d6e4f2')
    elif state in THREAD:
        slack_frame(im, 'Thread', f'#{CHANNEL}')
        y = message(im, 232, 112, 'user', '10:42 AM', MENTION)
        ImageDraw.Draw(im).line((232, y-4, 1020, y-4), fill=S_LINE)
        count = '1 reply' if state == 'thread' else '4 replies' if state in ('reply-working', 'reply-done') else '2 replies'
        txt(im, (232, y+2), count, 14, '#1d9bd1', True)
        y += 32
        if state == 'thread':
            top, y = y, message(im, 232, y, 'zana', '10:42 AM', '', extra=status('working', 'Working…'))
            BOXES[state] = (226, top-8, 1024, y)
        elif state.startswith(('asked', 'answering')) or state in ('resumed', 'answered'):
            if state.startswith(('asked', 'answering')):
                y = message(im, 232, y, 'zana', '10:42 AM', '', extra=status('done', 'Answer the questions here to continue.'))
            top, y = y, message(im, 232, y, 'zana', '10:44 AM', QUESTION, extra=ask_actions)
            if state.startswith(('asked', 'answering')):
                BOXES['asked'], BOXES['answer-btn'] = (226, top-8, 1024, y), BOXES['_answer-btn']
            if state == 'resumed':
                top, y = y, message(im, 232, y, 'zana', '10:46 AM', '', extra=status('working', 'Working…'))
                BOXES[state] = (226, top-8, 1024, y)
            elif state == 'answered':
                top, y = y, message(im, 232, y, 'zana', '10:51 AM', ANSWER)
                BOXES[state] = (226, top-8, 1024, y)
        else:
            y = message(im, 232, y, 'zana', '10:51 AM', ANSWER_SHORT)
            if state != 'reply':
                y = message(im, 232, y, 'user', '10:53 AM', FOLLOWUP)
                if state == 'reply-working':
                    message(im, 232, y, 'zana', '10:53 AM', '', extra=status('working', 'Working…'))
                else:
                    top, y = y, message(im, 232, y, 'zana', '10:58 AM', ANSWER2)
                    BOXES[state] = (226, top-8, 1024, y)
        composer(im, FOLLOWUP[:typed] if state == 'reply' else '', 'Reply…')
        if state.startswith('answering'):
            answer_form(im, state == 'answering-open', state == 'answering-chosen')
    elif state in ('dm', 'dm-asked', 'dm-done'):
        slack_frame(im, 'Zana', None, active='zana')
        app_tabs(im, 'Messages')

        def prompts(im, x, y):
            for label, w in [('Unread reports', 150), ('Find a report', 140), ('Review my work', 156), ('Plan a task', 120)]:
                rr(im, (x, y+2, x+w, y+36), '#222529', 18, '#5e6066')
                txt(im, (x+w/2, y+19), label, 14, S_INK, anchor='mm')
                BOXES.setdefault('dm-chip', (x-6, y-4, x+w+6, y+42))
                x += w+10
            return y+44
        y = message(im, 232, 112, 'zana', '9:02 AM', WELCOME, extra=prompts)
        if state != 'dm':
            y = message(im, 232, y, 'user', '9:14 AM', 'Show my unread reports.')
            if state == 'dm-asked':
                txt(im, (284, y+4), 'Zana is working…', 15, S_DIM)
            else:
                top, y = y, message(im, 232, y, 'zana', '9:14 AM', REPORTS)
                BOXES[state] = (222, top-8, 1024, y)
        composer(im, '', 'Message Zana')
    elif state == 'home':
        slack_frame(im, 'Zana', None, active='zana')
        d = ImageDraw.Draw(im)
        app_tabs(im, 'Home')
        txt(im, (240, 112), 'Zana · Your agents', 24, WHITE, True)
        txt(im, (240, 148), f'Acme · Private dashboard for {USER}', 14, S_DIM)
        x = 240
        for i, (mark, label) in enumerate([('#2bac76', '1 running'), ('#e8912d', '0 need attention'), ('check', '2 recent')]):
            if i: txt(im, (x, 178), '·', 15, S_DIM); x += 18
            if mark == 'check': d.line([(x, 188), (x+5, 193), (x+13, 182)], fill=S_INK, width=2)
            else: d.ellipse((x, 182, x+13, 195), fill=mark)
            txt(im, (x+20, 178), label, 15, S_INK, True)
            x += 20+d.textlength(label, font=font(15, True))+10
        button(im, (240, 210, 370, 242), '+ New agent', size=14, dark=True, accent=S_GREEN)
        button(im, (380, 210, 470, 242), 'Refresh', primary=False, dark=True, size=14)

        def card(y, title, meta, buttons, key=None):
            rr(im, (240, y, 1020, y+100), '#222529', 9, '#3a3c41')
            txt(im, (262, y+12), title, 17, WHITE, True)
            txt(im, (262, y+38), meta, 14, S_DIM)
            x = 262
            for label, danger in buttons:
                w = int(d.textlength(label, font=font(14, True)))+30
                rr(im, (x, y+62, x+w, y+92), '#2b2d31', 6, '#e01e5a' if danger else '#5e6066')
                txt(im, (x+w/2, y+77), label, 14, '#f28ba8' if danger else S_INK, True, anchor='mm')
                if danger: BOXES['home-stop'] = (x-6, y+56, x+w+6, y+98)
                x += w+10
            if key: BOXES[key] = (234, y-6, 1026, y+106)
        txt(im, (240, 256), 'Running', 17, WHITE, True)
        card(284, 'Add a test for the bulk insert path', f'{PROJECT} · #{CHANNEL} · running',
             [('Open conversation', False), ('Stop', True), ('Mute updates', False)], 'home-running')
        txt(im, (240, 398), 'Recent conversations', 17, WHITE, True)
        card(426, 'Fix the failing AccountService tests', f'{PROJECT} · #{CHANNEL} · Turn ended · Answer delivered',
             [('Open conversation', False), ('Open result', False), ('Mute updates', False)])
        card(534, 'Review my open pull requests', 'Website · Private agent chat · Turn ended · Answer delivered',
             [('Open conversation', False), ('Open result', False), ('Mute updates', False)])
    return im


TOOLS = [
    ('sf_apex', 'test.run', 'AccountServiceTest · 3 of 12 failing', '#f2a65a'),
    ('sf_apex', 'diagnose.file', 'AccountService.cls:48 · Owner can be null', ACCENT),
    ('edit', 'AccountService.cls', '+4 −1 · handle a missing Owner', ACCENT),
    ('sf_apex', 'test.rerun', 'AccountServiceTest · 12 of 12 passing', GREEN),
]


@lru_cache(None)
def zana(shown=0, done=False):
    """Zana desktop thread for the Slack-started Pi agent."""
    im = Image.new('RGBA', (1040, 650))
    rr(im, (0, 0, 1039, 649), '#1e1e1e', 22, '#4a4b55', 2)
    d = ImageDraw.Draw(im)
    for i, color in enumerate(['#ff6865', '#f5c14b', '#56c86a']):
        d.ellipse((23+i*24, 21, 35+i*24, 33), fill=color)
    txt(im, (520, 28), 'Zana', 18, '#d3d3df', anchor='mm')
    d.line((0, 54, 1040, 54), fill='#383943')
    im.alpha_composite(logo(28), (25, 78))
    txt(im, (66, 81), 'Zana', 22, WHITE, True)
    for i, label in enumerate(['Inbox', 'Agents', 'Projects', 'Schedules']):
        y = 144+i*52
        if label == 'Agents': rr(im, (16, y-9, 218, y+32), '#30313a', 9)
        txt(im, (30, y), label, 20, WHITE if label == 'Agents' else '#b6b6c2')
    txt(im, (30, 372), 'PROJECTS', 13, '#888c99', True)
    for i, (name, color) in enumerate([(PROJECT, '#54bde3'), ('Website', '#a68cff')]):
        d.ellipse((30, 412+i*42, 38, 420+i*42), fill=color)
        txt(im, (50, 405+i*42), name, 17, '#b6b6c2')
    d.line((234, 55, 234, 650), fill='#383943')
    txt(im, (262, 74), 'Slack · Fix the failing AccountService tests…', 22, WHITE, True)
    rr(im, (262, 116, 1012, 160), '#2a2a31', 10)
    txt(im, (280, 128), TASK, 16, '#dcdce6')
    y = 176
    for tool, action, detail, color in TOOLS[:shown]:
        rr(im, (262, y, 1012, y+50), '#25262b', 10, '#3e404c')
        check(im, 290, y+25, 12, color if color != ACCENT else '#9d8cf0')
        txt(im, (316, y+5), tool, 16, WHITE, True, mono=tool == 'sf_apex')
        tw = d.textlength(tool, font=font(16, True, tool == 'sf_apex'))
        txt(im, (316+tw+10, y+6), action, 15, ACCENT, mono=True)
        txt(im, (316, y+28), detail, 14, MUTED)
        y += 58
    if done:
        wrap(im, (266, y+8), ANSWER_SHORT, 740, 16, '#dcdce6', gap=1.4)
    elif 0 < shown < len(TOOLS):
        txt(im, (276, y+8), f'Pi is working {"•" * (1 + shown % 3)}', 15, MUTED)
    rr(im, (262, 556, 1012, 630), '#25262b', 12, '#3e404c')
    txt(im, (282, 568), 'Send a follow-up…', 15, '#7d7e81')
    x = 282
    for label in ['Pi', MODEL]:
        w = int(d.textlength(label, font=font(13, True)))+20
        rr(im, (x, 596, x+w, 620), '#30313a', 12)
        txt(im, (x+10, 600), label, 13, '#c9c9d6', True)
        x += w+8
    return im


def side_card(layer, title, kind, text):
    """Small card under the caption: channel defaults, or what Pi is doing on your computer."""
    rr(layer, (99, 852, 719, 940), S_BG, 12, '#45474b')
    txt(layer, (121, 866), title, 15, S_DIM, True)
    status(kind, text)(layer, 121, 900)


@lru_cache(None)
def backdrop():
    small = Image.new('RGB', (W//4, H//4))
    pixels = small.load()
    for y in range(H//4):
        for x in range(W//4):
            glow = math.exp(-(((x-355)/180)**2+((y-113)/150)**2))
            pixels[x, y] = (int(15+14*glow), int(18+11*glow), int(30+34*glow))
    im = small.resize((W, H), Image.Resampling.BICUBIC).convert('RGBA')
    d = ImageDraw.Draw(im)
    for r in (430, 540, 650): d.ellipse((1390-r, 470-r, 1390+r, 470+r), outline=(97, 96, 156, 20), width=1)
    im.alpha_composite(logo(48), (96, 62))
    txt(im, (160, 71), 'Zana', 29, WHITE, True)
    d.line((249, 69, 249, 103), fill='#45425c', width=1)
    txt(im, (273, 79), 'ZANA FOR SLACK  ·  ANY HARNESS', 17, '#bcb6d0', True)
    return im


def frame(seconds):
    start, end, kind, title, body = next((s for s in SCENES if s[0] <= seconds < s[1]), SCENES[-1])
    t = seconds-start
    im = backdrop().copy()
    layer = Image.new('RGBA', (W, H))
    if kind == 'intro': badge(layer, (98, 242), 'Slack → your computer')
    elif kind == 'home': badge(layer, (98, 242), 'Zana Home', GREEN, '#1b3c36')
    else: txt(layer, (98, 247), f'{SCENES.index((start, end, kind, title, body)):02d} / 05', 23, ACCENT, True)
    y = wrap(layer, (94, 317), title, 700, 75, WHITE, True, 1.13)
    wrap(layer, (99, y+42), body, 663, 28, MUTED, gap=1.48)
    if kind == 'intro':
        add_shadow(layer, zana(len(TOOLS), True).resize((770, 481), Image.Resampling.LANCZOS), 1040, 200, 20)
        add_shadow(layer, slack('answered').resize((700, 437), Image.Resampling.LANCZOS), 860, 470, 16)
    elif kind == 'launch':
        if t < 4.8:
            typed = 0 if t < .5 else min(3, 1+int((t-.5)*5)) if t < 2.2 else min(len(MENTION), 6+int(max(0, t-2.4)*40))
            panel = slack('channel', typed).copy()
            if 0 < typed < 6: pulse(panel, (464, 527), t, 1.8, mouse=True)
            highlight(panel, (228, 566, 1020, 628), t, 2.3, 4.7)
            pulse(panel, (989, 597), t, 4.3, mouse=True)
        elif t < 7.6:
            panel = slack('mentioned' if t < 5.8 else 'mentioned-reply').copy()
            if t >= 5.8:
                box = BOXES['reply-link']
                highlight(panel, box, t, 6.0, 7.5)
                pulse(panel, ((box[0]+box[2])//2, (box[1]+box[3])//2), t, 7.0, mouse=True)
        else:
            panel = slack('thread').copy()
            highlight(panel, BOXES['thread'], t, 7.9, 11.6)
        add_shadow(layer, panel, *PANEL, 18)
        badge(layer, (99, 792), 'Any harness installed in Zana')
        if t >= 4.8: side_card(layer, f'#{CHANNEL} · linked in Zana', 'done', f'{PROJECT}  ·  Pi  ·  {MODEL}')
    elif kind == 'work':
        if t < 2.4: state = 'thread'
        elif t < 4.8: state = 'asked'
        elif t < 5.6: state = 'answering'
        elif t < 6.8: state = 'answering-open'
        elif t < 8.4: state = 'answering-chosen'
        else: state = 'resumed'
        panel = slack(state).copy()
        if state == 'asked':
            highlight(panel, BOXES['asked'], t, 2.6, 4.7)
            pulse(panel, BOXES['answer-btn'], t, 4.2, mouse=True)
        elif state == 'answering':
            pulse(panel, BOXES['select'], t, 5.1, mouse=True)
        elif state == 'answering-open':
            pulse(panel, BOXES['option'], t, 6.3, mouse=True)
        elif state == 'answering-chosen':
            highlight(panel, (250, BOXES['select'][1]-22, 800, BOXES['select'][1]+22), t, 6.8, 7.6)
            pulse(panel, BOXES['send'], t, 7.9, mouse=True)
        elif state == 'resumed':
            highlight(panel, BOXES['resumed'], t, 8.6, 12.8)
        add_shadow(layer, panel, *PANEL, 18)
        badge(layer, (99, 792), 'Running on your computer', GREEN, '#1b3c36')
        title = 'On your computer · Pi'
        if t < .8: side_card(layer, title, 'working', 'Working…')
        elif t < 2.4: side_card(layer, title, 'working', 'sf_apex test.run · 3 of 12 failing' if t < 1.6 else 'sf_apex diagnose.file · Owner can be null')
        elif t < 8.4: side_card(layer, title, 'queued', 'Waiting for your answer in Slack')
        elif t < 10.6: side_card(layer, title, 'working', 'edit AccountService.cls · handle a missing Owner')
        else: side_card(layer, title, 'done', 'sf_apex test.rerun · 12 of 12 passing')
    elif kind == 'answer':
        state = 'resumed' if t < 2.2 else 'answered'
        panel = slack(state).copy()
        if state == 'answered': highlight(panel, BOXES['answered'], t, 2.6, 9.5)
        add_shadow(layer, panel, *PANEL, 18)
        badge(layer, (99, 792), 'Answer delivered to Slack', GREEN, '#1b3c36')
    elif kind == 'followup':
        typed = max(0, min(len(FOLLOWUP), int((t-.9)*18)))
        state = 'reply' if t < 4.0 else 'reply-working' if t < 6.6 else 'reply-done'
        panel = slack(state, typed if state == 'reply' else 0).copy()
        if state == 'reply':
            highlight(panel, (228, 566, 1020, 628), t, .6, 3.9)
            pulse(panel, (989, 597), t, 3.4, mouse=True)
        if state == 'reply-done': highlight(panel, BOXES['reply-done'], t, 6.9, 10.5)
        add_shadow(layer, panel, *PANEL, 18)
        badge(layer, (99, 792), 'Same Zana conversation')
    elif kind == 'private':
        state = 'dm' if t < 3.4 else 'dm-asked' if t < 5.2 else 'dm-done'
        panel = slack(state).copy()
        if state == 'dm':
            box = BOXES['dm-chip']
            highlight(panel, box, t, 1.0, 3.3)
            pulse(panel, ((box[0]+box[2])//2, (box[1]+box[3])//2), t, 2.8, mouse=True)
        if state == 'dm-done': highlight(panel, BOXES['dm-done'], t, 5.6, 11.5)
        add_shadow(layer, panel, *PANEL, 18)
        badge(layer, (99, 792), 'Only you see this chat')
    else:
        panel = slack('home').copy()
        highlight(panel, BOXES['home-running'], t, .8, 4.2)
        highlight(panel, BOXES['home-stop'], t, 4.4, 7.4)
        add_shadow(layer, panel, *PANEL, 18)
        wrap(layer, (99, 792), 'Keep your computer awake and online,\nwith Zana running.', 665, 23, MUTED, gap=1.4)
    alpha = min(ease(t/.4), ease((end-seconds)/.25))
    if alpha < 1: layer.putalpha(layer.getchannel('A').point(lambda a: int(a*alpha)))
    im.alpha_composite(layer, (0, int(12*(1-ease(t/.4)))))
    rr(im, (96, 984, 1824, 988), '#36344c', 2)
    rr(im, (96, 984, 96+int(1728*seconds/DURATION), 988), ACCENT, 2)
    txt(im, (97, 1015), 'Illustrated walkthrough · sample workspace, Project, org, and messages', 17, '#9292ac')
    txt(im, (1824, 1015), f'{int(seconds):02d} / {DURATION}', 17, '#b8b4d0', mono=True, anchor='ra')
    return im.convert('RGB')


def duration(path):
    data = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)])
    return float(json.loads(data)['format']['duration'])


def spoken(caption):
    return caption


def narration():
    audio_dir = OUT / 'audio-neural'
    audio_dir.mkdir(exist_ok=True)
    rate = 48000
    timeline = bytearray(DURATION*rate*2)
    timings = []
    for i, (start, end, caption) in enumerate(NARRATION):
        line = spoken(caption)
        digest = hashlib.sha256(f'{VOICE}|{VOICE_RATE}|{line}'.encode()).hexdigest()[:12]
        source = audio_dir / f'{digest}.mp3'
        source.with_suffix('.txt').write_text(line)
        if not source.exists() or source.stat().st_size < 1000:
            import edge_tts
            pending = source.with_suffix('.pending.mp3')
            asyncio.run(edge_tts.Communicate(line, VOICE, rate=VOICE_RATE, proxy=os.environ.get('HTTPS_PROXY')).save(str(pending)))
            pending.replace(source)
        trimmed = source.with_suffix('.wav')
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-af', 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.10,areverse', '-ar', str(rate), '-ac', '1', str(trimmed)], check=True)
        raw = duration(trimmed)
        if raw > end-start:
            raise ValueError(f'Extend scene {i}: {raw:.2f}s narration exceeds {end-start:.2f}s slot. Preserve natural voice pace.')
        with wave.open(str(trimmed), 'rb') as clip:
            assert (clip.getframerate(), clip.getnchannels(), clip.getsampwidth()) == (rate, 1, 2)
            samples = clip.readframes(clip.getnframes())
        offset = round(start*rate)*2
        timeline[offset:offset+len(samples)] = samples
        timings.append({'start': start, 'end': round(start+raw, 3), 'slot_end': end, 'speech_seconds': round(raw, 3), 'text': caption})
        print(f'Narration {i+1}/{len(NARRATION)}: {raw:.2f}s / {end-start:.2f}s', flush=True)
    assembled = audio_dir / 'assembled.wav'
    with wave.open(str(assembled), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(timeline)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(assembled), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', str(rate), '-ac', '1', '-t', str(DURATION), str(OUT/'voiceover.wav')], check=True)
    assert abs(duration(OUT/'voiceover.wav')-DURATION) < .05
    (audio_dir/'timings.json').write_text(json.dumps(timings, indent=2)+'\n')


def text_assets():
    srt, vtt = [], ['WEBVTT\n']
    for i, (start, end, line) in enumerate(NARRATION, 1):
        srt.append(f'{i}\n{kit.stamp(start)} --> {kit.stamp(end)}\n{line}\n')
        vtt.append(f'{kit.stamp(start, ".")} --> {kit.stamp(end, ".")}\n{line}\n')
    (OUT/'zana-slack.en.srt').write_text('\n'.join(srt))
    (OUT/'zana-slack.en.vtt').write_text('\n'.join(vtt))
    (OUT/'narration.txt').write_text('\n\n'.join(line for _, _, line in NARRATION)+'\n')
    (OUT/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zana for Slack</title><style>body{margin:0;background:#101321;color:#f5f4ff;font:16px system-ui;padding:32px}main{max-width:1100px;margin:auto}h1{font-size:28px}p{color:#b5bad0;line-height:1.6}video{width:100%;border-radius:16px;background:#101321}a{color:#baa9ff}</style><main><h1>Zana for Slack</h1><p>Mention @Zana in a linked Slack channel to start an agent with any harness installed in Zana (Pi in this demo). Answer its questions in Slack, and follow up in the thread. 74 seconds, with Ava neural voiceover.</p><video controls playsinline preload="metadata" poster="poster.jpg"><source src="zana-slack.mp4" type="video/mp4"><track kind="captions" src="zana-slack.en.vtt" srclang="en" label="English"></video><p><a href="zana-slack.mp4" download>Download MP4</a></p></main></html>''')


def stills():
    moments = [('intro', 2.5), ('mention', 7.0), ('typed', 9.4), ('thread', 14), ('working', 18.2), ('question', 21.0),
               ('answer-form', 23.6), ('resumed', 28.5), ('answer', 35), ('followup', 50), ('private', 61), ('home', 70)]
    sheet = Image.new('RGB', (1920, 1440), '#101321')
    for i, (name, second) in enumerate(moments):
        im = frame(second)
        im.save(OUT/f'preview-{name}.jpg', quality=93)
        sheet.paste(im.resize((640, 360), Image.Resampling.LANCZOS), (i % 3*640, i//3*360))
    sheet.save(OUT/'contact-sheet.jpg', quality=94)
    frame(2.5).save(OUT/'poster.jpg', quality=95)


def render():
    pending = OUT/'zana-slack.pending.mp4'
    cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', str(OUT/'voiceover.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', str(DURATION), '-movflags', '+faststart', '-metadata', 'title=Zana for Slack', '-metadata', 'comment=Illustrated Slack walkthrough; Ava synthetic narration; sample workspace, Project, org, and messages.', str(pending)]
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for n in range(FPS*DURATION):
            process.stdin.write(frame(n/FPS).tobytes())
            if n % (FPS*8) == 0: print(f'Rendered {n//FPS}/{DURATION} seconds', flush=True)
    finally:
        process.stdin.close()
    if process.wait() != 0: raise RuntimeError('ffmpeg encoding failed')
    pending.replace(OUT/'zana-slack.mp4')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--stills', action='store_true')
    parser.add_argument('--audio-only', action='store_true')
    args = parser.parse_args()
    text_assets()
    if args.audio_only: narration()
    else:
        stills()
        if not args.stills:
            narration()
            render()
