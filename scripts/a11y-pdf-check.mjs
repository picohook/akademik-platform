#!/usr/bin/env node
// Local inspection only: source facts and review flags, never WCAG approval.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../spike/app/package.json',import.meta.url));

export function selectedPages(value,total){
  if(!value||value==='all')return Array.from({length:total},(_,i)=>i+1);
  const pages=new Set();
  for(const part of value.split(',')){
    const m=/^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if(!m)throw Error('Pages must be all or comma-separated numbers/ranges');
    const start=Number(m[1]),end=Number(m[2]||m[1]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>total)throw Error('Page range outside document');
    for(let p=start;p<=end;p++)pages.add(p);
  }
  return [...pages].sort((a,b)=>a-b);
}

export async function inspectPdf(file,{pages='all',hocrDir=null}={}){
  const info=await stat(file);
  if(!info.isFile()||info.size>300*1024*1024)throw Error('PDF must be a file of at most 300 MiB');
  const bytes=await readFile(file),pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
  const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,verbosity:0,useSystemFonts:true}).promise;
  const report={schemaVersion:1,kind:'pdf-source-inspection',conformance:'not_assessed',source:{name:path.basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},totalPages:pdf.numPages,pages:[],scope:{requested:pages,complete:false},automatedFindings:[],humanReview:['Visual vs reading order on each page','OCR text accuracy, language and column order where used','Meaning and adequacy of figure/formula alternatives','Heading/table relationships and publisher semantics']};
  try{
    const selected=selectedPages(pages,pdf.numPages);report.scope.complete=selected.length===pdf.numPages;
    for(const number of selected){
      const page=await pdf.getPage(number);
      try{
        const text=await page.getTextContent();
        let tree=null,structureError=false;
        try{tree=await page.getStructTree();}catch{structureError=true;}
        const roles={},missingAlternatives={Figure:0,Formula:0};let visited=0,truncated=false;
        function visit(node,depth=0){if(!node)return;if(depth>100||++visited>10000){truncated=true;return;}if(node.role){roles[node.role]=(roles[node.role]||0)+1;if(Object.hasOwn(missingAlternatives,node.role)&&!(typeof node.alt==='string'&&node.alt.trim()))missingAlternatives[node.role]++;}for(const child of node.children||[])visit(child,depth+1);}
        visit(tree);
        let ocrWords=0,ocrPresent=false;
        if(hocrDir){try{const ocrFile=path.join(hocrDir,`page-${String(number).padStart(3,'0')}.hocr`);const size=await stat(ocrFile);if(size.size>20*1024*1024)throw Error('hOCR exceeds 20 MiB per page');const hocr=await readFile(ocrFile,'utf8');ocrPresent=true;ocrWords=[...hocr.matchAll(/class\s*=\s*["'][^"']*\bocrx_word\b[^"']*["']/gi)].length;}catch(error){if(error.code!=='ENOENT')throw error;}}
        const characters=text.items.reduce((sum,item)=>sum+(item.str?.trim().length||0),0);
        const row={number,textCharacters:characters,textLanguage:text.lang||null,sourceStructure:!!tree,roles,missingAlternatives,ocrPresent,ocrWords,structureError,truncated};report.pages.push(row);
        const flag=code=>report.automatedFindings.push({page:number,code,action:'review_required'});
        if(!characters&&!ocrWords)flag('no_readable_text');
        if(!tree)flag('no_source_structure');
        if(ocrWords)flag('ocr_requires_accuracy_and_order_review');
        if(ocrPresent&&!ocrWords)flag('ocr_has_no_word_records');
        if(structureError||truncated)flag('structure_inspection_incomplete');
        for(const [role,count]of Object.entries(missingAlternatives))if(count)flag(role.toLowerCase()+'_missing_source_alternative');
      }finally{page.cleanup();}
    }
    report.automatedStatus=report.automatedFindings.length?'review_required':'no_automatic_findings';
    return report;
  }finally{await pdf.destroy();}
}

async function main(){
  const args=process.argv.slice(2),options={};let file,out;
  for(let i=0;i<args.length;i++){
    if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Each option requires a value');
    if(args[i]==='--pdf')file=args[++i];else if(args[i]==='--pages')options.pages=args[++i];else if(args[i]==='--hocr-dir')options.hocrDir=args[++i];else if(args[i]==='--out')out=args[++i];else throw Error('Usage: node scripts/a11y-pdf-check.mjs --pdf file.pdf [--pages all|1,3-5] [--hocr-dir directory] [--out report.json]');
  }
  if(!file)throw Error('--pdf is required');
  if(out&&path.extname(out).toLowerCase()!=='.json')throw Error('--out must be a new .json file');
  const report=JSON.stringify(await inspectPdf(file,options),null,2)+'\n';
  if(out)await writeFile(out,report,{flag:'wx'});else process.stdout.write(report);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
