'use strict';

function findReceiptOrder(id) {
  return state.deliveries.find(order => order.id === id) ||
    state.history.find(day => day.id === selectedHistory)?.deliveries.find(order => order.id === id);
}

function receiptPdfButtons(id) {
  return '<div class="receipt-actions">' +
    '<button class="button primary" data-action="shareReceipt" data-id="' + esc(id) + '">Share PDF</button>' +
    '<button class="button" data-action="downloadReceipt" data-id="' + esc(id) + '">Download PDF</button>' +
    '<button class="button" data-action="print">Print</button></div>' +
    '<p class="help receipt-share-help">Choose WhatsApp or Messages in your share menu, or download and attach the PDF.</p>';
}

function pdfString(value) {
  return '(' + Array.from(String(value).normalize('NFC').replace(/[‘’]/g, "'").replace(/[–—]/g, '-'), letter => {
    const code = letter.codePointAt(0);
    if (code >= 160 && code <= 255) return '\\' + code.toString(8);
    if (code < 32 || code > 126) return '?';
    return /[()\\]/.test(letter) ? '\\' + letter : letter;
  }).join('') + ')';
}

function receiptPdf(order) {
  const pages = [];
  const left = 54, right = 558, center = 306;
  let lines, y;
  function newPage() {
    lines = ['1 1 1 rg 0 0 612 792 re f\n'];
    pages.push(lines);
    y = 726;
  }
  function width(value, size) {
    return Array.from(String(value).normalize('NFD').replace(/\p{Mark}/gu, ''))
      .reduce((sum, char) => sum + (/[ilI.,' ]/.test(char) ? .27 : /[MWmw]/.test(char) ? .84 :
        /[A-Z]/.test(char) ? .67 : .54), 0) * size;
  }
  function wrap(value, size, maxWidth) {
    const rows = [];
    let row = '';
    for (const word of String(value).trim().split(/\s+/)) {
      if (row && width(row + ' ' + word, size) > maxWidth) {
        rows.push(row);
        row = '';
      }
      if (row) row += ' ';
      for (const char of word) {
        if (width(row + char, size) > maxWidth && row) {
          rows.push(row);
          row = '';
        }
        row += char;
      }
    }
    if (row) rows.push(row);
    return rows;
  }
  function text(value, x, baseline, {size = 13, font = 'R', color = '0.09 0.24 0.21', spacing = 0} = {}) {
    lines.push('BT /' + font + ' ' + size + ' Tf ' + color + ' rg ' + spacing + ' Tc ' +
      x.toFixed(2) + ' ' + baseline + ' Td ' + pdfString(value) + ' Tj ET\n');
  }
  function centered(value, size, font, spacing = 0, color) {
    for (const row of wrap(value, size + spacing * 2, right - left - 12)) {
      text(row, center - (width(row, size) + spacing * (row.length - 1)) / 2, y, {size, font, spacing, color});
      y -= size + 9;
    }
  }
  function rule(baseline) {
    lines.push('q 0.81 0.85 0.78 RG 0.7 w [2 2] 0 d ' + left + ' ' + baseline +
      ' m ' + right + ' ' + baseline + ' l S Q\n');
  }
  function row(label, value, emphasis = false) {
    const size = emphasis ? 21 : 13;
    const amountWidth = width(value, size);
    const rows = wrap(label, size, right - left - amountWidth - 25);
    for (const [index, part] of rows.entries()) {
      if (y < 60) newPage();
      text(part, left, y, {size, font: emphasis ? 'B' : 'R'});
      if (!index) text(value, right - amountWidth, y, {size, font: emphasis ? 'B' : 'R'});
      y -= size + 6;
    }
    if (!emphasis) rule(y + 5);
    y -= emphasis ? 17 : 14;
  }
  const muted = '0.36 0.41 0.37';
  newPage();
  centered((state.demo ? 'SAMPLE · ' : '') + receiptBusinessName(order), 11, 'B', 2);
  y -= 13;
  centered(customerThankYou(order.name), 30, 'T');
  y -= 5;
  centered(order.receiptId + ' · ' + (order.day || state.settings.date), 11, 'R', 0, muted);
  centered(order.name, 11, 'R', 0, muted);
  y -= 23;
  for (const item of orderItems(order)) {
    row(item.qty + ' × ' + item.name, money(item.qty * item.price));
  }
  if (order.orderType !== 'pickup') row('Delivery fee', money(order.fee));
  if (y < 185) newPage();
  row('Total', money(total(order)), true);
  row('Payment status', order.paid ? 'Paid' : 'Unpaid');
  row('Payment method', order.method);
  y -= 8;
  centered('Payment recorded by staff.', 10, 'R', 0, muted);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, index) => (6 + index * 2) + ' 0 R').join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>'
  ];
  for (const page of pages) {
    const content = page.join('');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /R 3 0 R /B 4 0 R /T 5 0 R >> >> /Contents ' +
      (objects.length + 2) + ' 0 R >>');
    objects.push('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
  }
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  pdf += offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return pdf + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
}

async function receiptPdfAction(id, share) {
  const order = findReceiptOrder(id);
  if (!order?.paid || !['Cash', 'Zelle', 'Cash App'].includes(order.method)) {
    toast('A recorded payment is required for this receipt.');
    return;
  }
  const name = String(order.receiptId || 'receipt').replace(/[^a-zA-Z0-9_-]/g, '-') + '.pdf';
  const file = new File([receiptPdf(order)], name, { type: 'application/pdf' });
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (share) toast('PDF downloaded. Attach it in WhatsApp or Messages.');
}
