import { modelGlyphId } from './model-meta.js';
import { ToolGlyph } from './tool-glyphs.js';

export function ModelGlyph({ model, ...props }) {
  const id = modelGlyphId(model);
  return id ? <ToolGlyph id={id} {...props}/> : null;
}
