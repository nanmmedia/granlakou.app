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
  let lines, y;
  function newPage() {
    lines = [];
    pages.push(lines);
    y = 740;
  }
  function line(text, size = 12, bold = false) {
    if (y < 54) newPage();
    lines.push('BT /' + (bold ? 'B' : 'R') + ' ' + size + ' Tf 0.09 0.24 0.21 rg 54 ' + y +
      ' Td ' + pdfString(text) + ' Tj ET\n');
    y -= size + 8;
  }
  function wrapped(text, size = 12, bold = false) {
    // Conservative width for Helvetica. Break long unspaced item names too.
    const max = Math.floor(504 / (size * 0.95));
    let row = '';
    for (const word of String(text).split(/\s+/)) {
      if (row && row.length + word.length + 1 > max) {
        line(row, size, bold);
        row = '';
      }
      let remaining = word;
      while (remaining.length > max) {
        line(remaining.slice(0, max), size, bold);
        remaining = remaining.slice(max);
      }
      row += (row ? ' ' : '') + remaining;
    }
    if (row) line(row, size, bold);
  }
  newPage();
  wrapped(receiptBusinessName(order), 18, true);
  line((state.demo ? 'SAMPLE ' : '') + (order.orderType === 'pickup' ? 'Pickup receipt' : 'Delivery receipt'), 22, true);
  wrapped(order.receiptId + ' | ' + (order.day || state.settings.date));
  wrapped('Customer: ' + order.name);
  y -= 16;
  for (const item of orderItems(order)) {
    wrapped(item.qty + ' × ' + item.name + ' @ ' + money(item.price) + ' = ' + money(item.qty * item.price));
  }
  if (order.orderType !== 'pickup') line('Delivery fee: ' + money(order.fee));
  y -= 8;
  line('Total: ' + money(total(order)), 16, true);
  line('Paid via ' + order.method);
  y -= 12;
  wrapped(customerThankYou(order.name));

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, index) => (5 + index * 2) + ' 0 R').join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  for (const page of pages) {
    const content = page.join('');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /R 3 0 R /B 4 0 R >> >> /Contents ' +
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
