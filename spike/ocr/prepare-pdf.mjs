#!/usr/bin/env node
// Offline workstation tool. It never installs OCR models or writes to an app/DB.
import {readFile,writeFile,mkdir,stat,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {selectedPages} from '../../scripts/a11y-pdf-check.mjs';
import {createWorker} from 'tesseract.js';
const here=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(new URL('../app/package.json',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function preparePdf({pdf:filename,out,lang,pages,dpi=150,contentLanguage,regions=null}){
  if(!filename||!out||!lang||!pages)throw Error('--pdf, --out, --lang and --pages are required');
  if(!/^[a-z]{3}$/.test(lang))throw Error('Use one installed three-letter OCR model (eng, tur, ...)');
  if(!Number.isFinite(dpi)||dpi<72||dpi>300)throw Error('DPI must be 72–300');
  const language=contentLanguage||({eng:'en',tur:'tr',ara:'ar',deu:'de',fra:'fr'}[lang]||lang);
  if(!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language))throw Error('Invalid content language');
  const plan=typeof regions==='string'?JSON.parse(await readFile(regions,'utf8')):regions;
  if(plan&&(!plan.pages||typeof plan.pages!=='object'||Array.isArray(plan.pages)))throw Error('Region plan requires a pages object');
  await access(path.join(here,lang+'.traineddata')); // Fail before OCR; no CDN fallback.
  const info=await stat(filename);if(!info.isFile()||info.size>300*1024*1024)throw Error('PDF must be a file of at most 300 MiB');
  const bytes=await readFile(filename),pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))),{createCanvas}=require('@napi-rs/canvas');
  const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,verbosity:0,useSystemFonts:true}).promise;
  let worker;
  try{
    const selected=selectedPages(pages,pdf.numPages),targets=selected.map(n=>`page-${String(n).padStart(3,'0')}.hocr`);
    const pageRegions=new Map();
    for(const number of selected){
      const items=plan?.pages[number]||[{left:0,top:0,width:1,height:1}];
      if(!Array.isArray(items)||!items.length||items.length>32)throw Error('Use 1–32 explicit regions per page');
      for(const r of items){if(!r||!['left','top','width','height'].every(k=>Number.isFinite(r[k]))||r.left<0||r.top<0||r.width<=0||r.height<=0||r.left+r.width>1.000000001||r.top+r.height>1.000000001)throw Error('Regions must be positive normalized rectangles inside the page');if(r.psm!==undefined&&![3,6,7,11,13].includes(r.psm))throw Error('Unsupported region PSM; use 3, 6, 7, 11 or 13');}
      for(let i=0;i<items.length;i++)for(let j=0;j<i;j++){const a=items[i],b=items[j];if(Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left)>1e-9&&Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top)>1e-9)throw Error('Overlapping regions would duplicate text');}
      pageRegions.set(number,items);
    }
    for(const name of [...targets,'report.json']){try{await access(path.join(out,name));throw Error('Refusing to overwrite existing output: '+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
    await mkdir(out,{recursive:true});
    worker=await createWorker(lang,1,{langPath:here,cachePath:here,cacheMethod:'readOnly',gzip:false});
    const report={schemaVersion:1,kind:'ocr-preparation',source:{name:path.basename(filename),sha256:sha(bytes),bytes:bytes.length,totalPages:pdf.numPages},model:lang,language,dpi,scope:{requested:pages,complete:selected.length===pdf.numPages},reviewRequired:true,conformance:'not_assessed',pages:[]};
    for(const number of selected){
      const page=await pdf.getPage(number);
      let canvas;
      try{
        const viewport=page.getViewport({scale:dpi/72}),width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
        if(width*height>16000000)throw Error('Rendered page exceeds 16 million pixels; lower DPI');
        canvas=createCanvas(width,height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const image=canvas.toBuffer('image/png'),fragments=[],texts=[],confidences=[],items=pageRegions.get(number);
        for(const [index,r]of items.entries()){
          const left=Math.round(r.left*width),top=Math.round(r.top*height),right=Math.round((r.left+r.width)*width),bottom=Math.round((r.top+r.height)*height);
          if(right<=left||bottom<=top)throw Error('Region has no pixels at selected DPI');
          await worker.setParameters({tessedit_pageseg_mode:String(r.psm??3),user_defined_dpi:String(Math.round(dpi))});
          const full=left===0&&top===0&&right===width&&bottom===height;
          let cropped;
          if(!full){cropped=createCanvas(right-left,bottom-top);cropped.getContext('2d').drawImage(canvas,left,top,right-left,bottom-top,0,0,right-left,bottom-top);}
          let data;
          try{({data}=await worker.recognize(full?image:cropped.toBuffer('image/png'),{},{text:true,hocr:true}));}finally{if(cropped){cropped.width=1;cropped.height=1;}}
          if(!data.hocr?.trim())throw Error('OCR produced no hOCR for page '+number);
          // Crop only the explicitly supplied regions, then translate generated
          // boxes back to the full page; never infer reading order or headings.
          const fragment=data.hocr.trim().replace(/^<div\b[^>]*class=['"]ocr_page['"][^>]*>/i,'').replace(/<\/div>\s*$/i,'').replace(/\bbbox\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/g,(_,x0,y0,x1,y1)=>`bbox ${Number(x0)+left} ${Number(y0)+top} ${Number(x1)+left} ${Number(y1)+top}`).replace(/\bid=(['"])([^'"]+)\1/g,(_,quote,id)=>`id=${quote}region_${index}_${id}${quote}`);
          fragments.push(fragment);texts.push(data.text||'');confidences.push(data.confidence??0);
        }
        const hocr=`<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body><div class="ocr_page" title="bbox 0 0 ${width} ${height}">${fragments.join('\n')}</div></body></html>\n`;
        const name=`page-${String(number).padStart(3,'0')}.hocr`;await writeFile(path.join(out,name),hocr,{flag:'wx'});
        report.pages.push({number,file:name,sha256:sha(hocr),textCharacters:texts.join('\n').trim().length,confidence:confidences.reduce((a,b)=>a+b,0)/confidences.length,regionConfidence:confidences,readingOrderMode:plan?.pages[number]?'explicit-regions':'full-page-OCR',regions:items,coverageRatio:items.reduce((sum,r)=>sum+r.width*r.height,0),reviewRequired:true});
        console.error(`[OCR] page ${number}/${pdf.numPages}: ${report.pages.at(-1).textCharacters} characters; human review required`);
      }finally{page.cleanup();if(canvas){canvas.width=1;canvas.height=1;}}
    }
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
  }finally{if(worker)await worker.terminate();await pdf.destroy();}
}
async function main(){
  const args=process.argv.slice(2),options={},keys={'--pdf':'pdf','--out':'out','--lang':'lang','--pages':'pages','--dpi':'dpi','--content-language':'contentLanguage','--regions':'regions'};
  for(let i=0;i<args.length;i++){const key=keys[args[i]];if(!key||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node spike/ocr/prepare-pdf.mjs --pdf file.pdf --out new-directory --lang eng --pages 1-5 [--dpi 150] [--content-language en] [--regions plan.json]');options[key]=key==='dpi'?Number(args[++i]):args[++i];}
  const report=await preparePdf(options);console.log(JSON.stringify({preparedPages:report.pages.length,report:path.join(options.out,'report.json'),reviewRequired:true}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
