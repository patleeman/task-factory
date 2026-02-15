import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_INPUT_HOTKEY,
  eventMatchesVoiceInputHotkey,
  formatVoiceInputHotkeyFromEvent,
  normalizeVoiceInputHotkey,
  parseVoiceInputHotkey,
  shouldStopVoiceInputHotkeyOnKeyup,
} from '../../client/src/voiceHotkey';

describe('voice hotkey helpers', () => {
  it('normalizes saved settings values with a stable default', () => {
    expect(DEFAULT_VOICE_INPUT_HOTKEY).toBe('Ctrl+Space');
    expect(normalizeVoiceInputHotkey(undefined)).toBe('Ctrl+Space');
    expect(normalizeVoiceInputHotkey(' alt + space ')).toBe('Alt+Space');
  });

  it('captures key combos from keyboard events', () => {
    expect(formatVoiceInputHotkeyFromEvent({
      key: ' ',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe('Alt+Space');

    expect(formatVoiceInputHotkeyFromEvent({
      key: 'Alt',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe('Alt');
  });

  it('matches keydown and keyup events for press-and-hold behavior', () => {
    const hotkey = parseVoiceInputHotkey('Alt+Space');
    expect(hotkey).not.toBeNull();

    expect(eventMatchesVoiceInputHotkey({
      key: ' ',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(true);

    expect(eventMatchesVoiceInputHotkey({
      key: 'Alt',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(false);

    expect(shouldStopVoiceInputHotkeyOnKeyup({
      key: ' ',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(true);

    expect(shouldStopVoiceInputHotkeyOnKeyup({
      key: 'Alt',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(true);
  });

  it('supports modifier-only hotkeys for one-handed operation', () => {
    const hotkey = parseVoiceInputHotkey('Alt');
    expect(hotkey).not.toBeNull();

    expect(eventMatchesVoiceInputHotkey({
      key: 'Alt',
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(true);

    expect(shouldStopVoiceInputHotkeyOnKeyup({
      key: 'Alt',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }, hotkey!)).toBe(true);
  });
});
