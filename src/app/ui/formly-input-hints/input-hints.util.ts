import { FormlyExtension, FormlyFieldConfig } from '@ngx-formly/core';

/** HTML attributes that tell a mobile keyboard what a text field takes. */
export type InputHintAttributes = Readonly<Record<string, string>>;

/** A field that holds neither prose nor a name: no capital, no correction, no spell check. */
export const LITERAL_INPUT_HINTS: InputHintAttributes = {
  autocapitalize: 'none',
  autocorrect: 'off',
  spellcheck: 'false',
};

/**
 * What a mobile keyboard needs to know about a text field, from its input `type`:
 * the layout (`inputmode`), whether it capitalises, corrects or spell-checks what
 * is typed, and what the Enter key says. Without them a URL or a user name starts
 * with a capital, gets "corrected", and Enter reads as a line break. A field can
 * still set any of them itself (`props.attributes` wins).
 *
 * `enterkeyhint` is `done` (a tick that closes the keyboard) because the Enter of
 * a settings field commits it and goes nowhere else; a field followed by another
 * one in its form says `next` itself.
 */
export const getInputHintAttributes = (type: string = 'text'): InputHintAttributes => {
  switch (type) {
    case 'url':
      return { inputmode: 'url', ...LITERAL_INPUT_HINTS, enterkeyhint: 'done' };
    case 'email':
      return { inputmode: 'email', ...LITERAL_INPUT_HINTS, enterkeyhint: 'done' };
    case 'password':
      return { ...LITERAL_INPUT_HINTS, enterkeyhint: 'done' };
    case 'search':
      return { enterkeyhint: 'search' };
    case 'tel':
      return { inputmode: 'tel', enterkeyhint: 'done' };
    case 'text':
    case 'number':
      return { enterkeyhint: 'done' };
    default:
      // date, time, color, file, ...: the browser's own control, nothing to hint.
      return {};
  }
};

/**
 * The formly extension that gives every plain `input` field the hints of its
 * `props.type` (see getInputHintAttributes). Fields of derived types (duration,
 * keyboard, icon, ...) have their own widgets and are left alone.
 */
export const mobileInputHintsExtension: FormlyExtension = {
  postPopulate: (field: FormlyFieldConfig): void => {
    if (field.type !== 'input') {
      return;
    }
    const hints = getInputHintAttributes(field.props?.type);
    if (Object.keys(hints).length === 0) {
      return;
    }
    field.props = {
      ...field.props,
      attributes: { ...hints, ...field.props?.attributes },
    };
  },
};
