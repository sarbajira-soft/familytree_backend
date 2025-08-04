import PDFDocument from 'pdfkit';
import fs from 'fs';

/**
 * Converts a markdown string to a simple PDF (no formatting, just plain text)
 * @param markdown The markdown string to export
 * @param outputPath The file path to save the PDF
 */
export function exportMarkdownToPDF(markdown: string, outputPath: string) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(outputPath));

  // For simplicity, just add the markdown as plain text
  doc.font('Times-Roman').fontSize(12).text(markdown, {
    width: 500,
    align: 'left',
  });

  doc.end();
} 