// Small deterministic PDF fixtures for production-worker and Electron import tests.
exports.pdfFixture = function pdfFixture({ pages = 1, scanned = false, cjk = false, columns = false, encrypted = false, lines = 1, text = 'Candidate resume' } = {}) {
  const objects = [], add = body => { objects.push(body); return objects.length }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`)
  add(cjk ? '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] >>'
    : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < pages; i++) {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    const literal = cjk ? '<501990094eba7b805386>' : `(${text.replace(/[\\()]/g, '\\$&')})`
    let content = scanned ? '' : Array.from({ length: lines }, (_, row) => `BT /F1 12 Tf 40 ${740 - row * 12} Td ${literal} Tj ET\n`).join('')
    if (columns) for (let row = 0; row < 4; row++) content += `BT /F1 12 Tf 40 ${680 - row * 24} Td (Left ${row + 1}) Tj ET\nBT /F1 12 Tf 340 ${680 - row * 24} Td (Right ${row + 1}) Tj ET\n`
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  }
  let encrypt = ''
  if (encrypted) {
    const id = add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> >>`)
    encrypt = `/Encrypt ${id} 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]`
  }
  let output = '%PDF-1.7\n', offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}
