import { exportMarkdownToPDF } from './plan-to-pdf.util';
import fs from 'fs';
// Use require for path to avoid undefined error in ts-node
const path = require('path');

const markdownPath = path.join(__dirname, 'plan-markdown.md');
const outputPath = path.join(__dirname, 'plan-for-md.pdf');

const markdown = fs.readFileSync(markdownPath, 'utf-8');
exportMarkdownToPDF(markdown, outputPath);

console.log('PDF exported to', outputPath); 