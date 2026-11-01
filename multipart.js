function indexOfBuf(haystack, needle, from) {
  return haystack.indexOf(needle, from);
}

function parseContentDisposition(raw) {
  const out = {};
  const name = /name="([^"]*)"/.exec(raw);
  const file = /filename="([^"]*)"/.exec(raw);
  if (name) out.name = name[1];
  if (file) out.filename = file[1];
  return out;
}

/**
 * Streaming-free multipart/form-data parser. Bodies are already capped by the
 * HTTP layer, so holding the whole buffer here is deliberate.
 */
function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let cursor = indexOfBuf(buffer, delimiter, 0);
  if (cursor < 0) return { fields, files };
  cursor += delimiter.length;

  while (cursor < buffer.length) {
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break;
    if (buffer[cursor] === 0x0d) cursor += 2;

    const headEnd = indexOfBuf(buffer, Buffer.from('\r\n\r\n'), cursor);
    if (headEnd < 0) break;
    const headers = buffer.slice(cursor, headEnd).toString('binary');
    const bodyStart = headEnd + 4;
    const next = indexOfBuf(buffer, delimiter, bodyStart);
    if (next < 0) break;

    let bodyEnd = next;
    if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const data = buffer.slice(bodyStart, bodyEnd);
    const cd = parseContentDisposition(headers);
    const typeMatch = /content-type:\s*([^;\r\n]+)/i.exec(headers);

    if (cd.filename !== undefined) {
      files.push({
        name: cd.name,
        filename: cd.filename,
        type: (typeMatch ? typeMatch[1] : '').trim().toLowerCase(),
        data,
      });
    } else if (cd.name) {
      fields[cd.name] = data.toString('utf8');
    }
    cursor = next + delimiter.length;
  }
  return { fields, files };
}

function boundaryFrom(contentType) {
  const m = /boundary\s*=\s*"?([^";\s]+)"?/i.exec(contentType || '');
  return m ? m[1] : null;
}

module.exports = { parseMultipart, boundaryFrom };
