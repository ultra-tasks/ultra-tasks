import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_STORED_IMAGE_EDGE,
  MAX_STORED_IMAGE_LENGTH,
  reduceImageFile,
  ReduceImageError,
} from './reduce-image-file.util';

const noisyPng = async (width: number, height: number): Promise<File> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(width, height);
  for (let i = 0; i < data.data.length; i++) {
    data.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png'),
  );
  return new File([blob], 'photo.png', { type: 'image/png' });
};

const imageSize = (dataUrl: string): Promise<[number, number]> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
    image.onerror = reject;
    image.src = dataUrl;
  });

describe('reduceImageFile()', () => {
  // Canvas codecs run asynchronously and exceeded the global 2s deadline in the
  // full suite. This checks output limits, not encoding speed.
  it('stores even a noisy photo small: ≤ 256 px and ≤ 24 KB', async () => {
    const dataUrl = await reduceImageFile(await noisyPng(1200, 800));
    expect(dataUrl).toMatch(/^data:image\/(webp|jpeg);base64,/);
    expect(dataUrl.length).toBeLessThanOrEqual(MAX_STORED_IMAGE_LENGTH);
    const [width, height] = await imageSize(dataUrl);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_STORED_IMAGE_EDGE);
    expect(width / height).toBeCloseTo(1.5, 1);
  }, 5000);

  it('does not enlarge a small image', async () => {
    const dataUrl = await reduceImageFile(await noisyPng(40, 20));
    expect(await imageSize(dataUrl)).toEqual([40, 20]);
  });

  it('rejects SVG and other non-raster files', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'a.svg', {
      type: 'image/svg+xml',
    });
    await expectAsync(reduceImageFile(svg)).toBeRejectedWith(
      new ReduceImageError('type'),
    );
  });

  it('rejects files too large to decode safely', async () => {
    const file = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: MAX_SOURCE_IMAGE_BYTES + 1 });
    await expectAsync(reduceImageFile(file)).toBeRejectedWith(
      new ReduceImageError('size'),
    );
  });

  it('reports a file that cannot be decoded', async () => {
    const broken = new File(['not an image'], 'broken.png', { type: 'image/png' });
    await expectAsync(reduceImageFile(broken)).toBeRejectedWith(
      new ReduceImageError('decode'),
    );
  });
});
