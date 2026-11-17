import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  getInputHintAttributes,
  LITERAL_INPUT_HINTS,
  mobileInputHintsExtension,
} from './input-hints.util';

describe('getInputHintAttributes', () => {
  it('asks a mobile keyboard for the URL layout, no capital and no correction', () => {
    expect(getInputHintAttributes('url')).toEqual({
      inputmode: 'url',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
    });
  });

  it('does the same for an email address, with its own layout', () => {
    expect(getInputHintAttributes('email')).toEqual(
      jasmine.objectContaining({ inputmode: 'email', autocapitalize: 'none' }),
    );
  });

  it('never capitalises, corrects or spell-checks a password', () => {
    expect(getInputHintAttributes('password')).toEqual(
      jasmine.objectContaining(LITERAL_INPUT_HINTS),
    );
    expect(getInputHintAttributes('password')['inputmode']).toBeUndefined();
  });

  it('turns the Enter key of a search field into Search', () => {
    expect(getInputHintAttributes('search')).toEqual({ enterkeyhint: 'search' });
  });

  it('makes plain text and numbers end in Done, and leaves prose capitalised', () => {
    expect(getInputHintAttributes('text')).toEqual({ enterkeyhint: 'done' });
    expect(getInputHintAttributes()).toEqual({ enterkeyhint: 'done' });
    expect(getInputHintAttributes('number')).toEqual({ enterkeyhint: 'done' });
  });

  it('has nothing to say about the browser controls', () => {
    for (const type of ['date', 'time', 'color', 'file', 'range']) {
      expect(getInputHintAttributes(type)).toEqual({});
    }
  });
});

describe('mobileInputHintsExtension', () => {
  const populate = (field: FormlyFieldConfig): FormlyFieldConfig => {
    mobileInputHintsExtension.postPopulate?.(field);
    return field;
  };

  it('sets the hints of the type on a plain input', () => {
    const field = populate({ type: 'input', props: { type: 'url', label: 'URL' } });
    expect(field.props?.label).toBe('URL');
    expect(field.props?.attributes).toEqual(
      jasmine.objectContaining({ inputmode: 'url', enterkeyhint: 'done' }),
    );
  });

  it('treats an input without a type as text', () => {
    const field = populate({ type: 'input', props: {} });
    expect(field.props?.attributes).toEqual({ enterkeyhint: 'done' });
  });

  it('lets a field say its own attributes: they win over the defaults', () => {
    const field = populate({
      type: 'input',
      props: { attributes: { enterkeyhint: 'next', autocomplete: 'off' } },
    });
    expect(field.props?.attributes).toEqual({
      enterkeyhint: 'next',
      autocomplete: 'off',
    });
  });

  it('leaves the other types alone', () => {
    for (const type of ['duration', 'keyboard', 'textarea', 'checkbox', 'select']) {
      const field = populate({ type, props: { label: 'x' } });
      expect(field.props?.attributes).toBeUndefined();
    }
  });

  it('does not touch an input whose type needs no hint', () => {
    const field = populate({ type: 'input', props: { type: 'color' } });
    expect(field.props?.attributes).toBeUndefined();
  });

  it('copes with a field that has no props yet', () => {
    const field = populate({ type: 'input' });
    expect(field.props?.attributes).toEqual({ enterkeyhint: 'done' });
  });
});
