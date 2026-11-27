import { JiraToMarkdownPipe } from './jira-to-markdown.pipe';

describe('JiraToMarkdownPipe', () => {
  const pipe = new JiraToMarkdownPipe();

  describe('code blocks', () => {
    it('keeps the language', () => {
      expect(pipe.transform('{code:java}\nfoo()\n{code}')).toBe('```java\nfoo()\n```');
    });

    it('drops block parameters', () => {
      expect(pipe.transform('{code:title=Foo.java|borderStyle=solid}\nbar\n{code}')).toBe(
        '```\nbar\n```',
      );
    });

    it('keeps the language when parameters follow it', () => {
      expect(pipe.transform('{code:java|title=Foo.java}\nbar\n{code}')).toBe(
        '```java\nbar\n```',
      );
    });

    it('drops parameters beyond title/border/color ones', () => {
      expect(pipe.transform('{code:java|linenumbers=true}\nbar\n{code}')).toBe(
        '```java\nbar\n```',
      );
    });

    it('converts a block without language', () => {
      expect(pipe.transform('{code}\nx\n{code}')).toBe('```\nx\n```');
    });
  });

  describe('table headers', () => {
    it('converts a header row and adds a separator row', () => {
      expect(pipe.transform('||a||b||')).toBe('\n|a|b|\n| --- | --- |');
    });

    it('ignores leading whitespace', () => {
      expect(pipe.transform('  ||a||')).toBe('\n|a|\n| --- |');
    });
  });
});
