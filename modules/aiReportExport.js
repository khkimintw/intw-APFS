const TITLE = '사업계획서 및 IR 검토 참고 보고서';

function reportSections(report) {
  const list = key => (report[key] || []).map(item => typeof item === 'string' ? item : Object.values(item).join(' · '));
  const metrics = (report.metrics || []).map(item =>
    [item.code + ' ' + item.name + ' · ' + (item.score == null ? '점수 보류' : item.score + '/4점') + ' · 가중치 ' + item.combinedWeight + '%',
      '근거: ' + (item.evidence || '확인된 근거 없음'), item.note].filter(Boolean).join('\n'));
  return [
    ['', [report.company_name, '분석 시각: ' + new Date(report.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      '모델: ' + report.model, '설문 가중 점수: ' + (report.overallScore == null ? '산정 불가' : report.overallScore + '/100'), report.disclaimer].filter(Boolean)],
    ['핵심 요약', [report.summary].filter(Boolean)],
    ['평가 항목과 근거', metrics],
    ['강점', list('strengths')], ['위험 요인', list('risks')],
    ['추가 확인 자료', list('missingEvidence')], ['보완 제안', list('recommendations')],
    ['분석에 사용한 자료', list('sources')], ['산정 기준', [report.scoreBasis].filter(Boolean)],
  ];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadWordReport(report, filename) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const children = [new Paragraph({ text: TITLE, heading: HeadingLevel.TITLE })];
  for (const [heading, paragraphs] of reportSections(report)) {
    if (heading) children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1, keepNext: true }));
    for (const text of paragraphs.length ? paragraphs : ['확인된 내용 없음']) {
      children.push(new Paragraph({
        children: text.split('\n').map((line, index) => new TextRun({ text: line, break: index ? 1 : 0 })),
      }));
    }
  }
  const doc = new Document({
    title: TITLE,
    styles: { default: { document: {
      run: { font: { ascii: 'Calibri', eastAsia: '맑은 고딕' }, size: 22 },
      paragraph: { spacing: { after: 130, line: 300 } },
    } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 } } }, children }],
  });
  downloadBlob(await Packer.toBlob(doc), filename + '.docx');
}

export async function downloadPdfReport(report, filename) {
  const [{ jsPDF }, font] = await Promise.all([
    import('jspdf'), fetch('/fonts/NanumGothic-Regular.ttf'),
  ]);
  if (!font.ok) throw new Error('PDF 글꼴을 불러오지 못했습니다.');
  const bytes = new Uint8Array(await font.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
  pdf.addFileToVFS('NanumGothic.ttf', btoa(binary));
  pdf.addFont('NanumGothic.ttf', 'NanumGothic', 'normal');
  pdf.setFont('NanumGothic');
  pdf.setProperties({ title: TITLE });
  let y = 22;
  function newPage() {
    pdf.addPage();
    y = 22;
  }
  function write(text, size, color, lineHeight, spacing) {
    pdf.setFontSize(size);
    pdf.setTextColor(color);
    for (const line of pdf.splitTextToSize(text, 174)) {
      if (y > 273) newPage();
      pdf.text(line, 18, y);
      y += lineHeight;
    }
    y += spacing;
  }
  write(TITLE, 19, '#153854', 9, 4);
  for (const [heading, paragraphs] of reportSections(report)) {
    if (heading) {
      if (y > 257) newPage();
      write(heading, 13, '#153854', 6, 2);
    }
    for (const text of paragraphs.length ? paragraphs : ['확인된 내용 없음']) write(text, 10, '#263848', 5, 3);
    y += 3;
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setFontSize(9);
    pdf.setTextColor('#536574');
    pdf.text(page + ' / ' + pdf.getNumberOfPages(), 192, 285, { align: 'right' });
  }
  downloadBlob(pdf.output('blob'), filename + '.pdf');
}
