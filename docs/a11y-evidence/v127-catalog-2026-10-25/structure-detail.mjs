import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const require=createRequire(path.resolve('spike/app/package.json')),pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))),inventory=JSON.parse(await readFile('tmp/acr-catalog-v127/inventory.json','utf8'));
const reports=[];
for(const b of inventory.entries){if(b.format!=='pdf')continue;let base,source;if(b.storageKey.startsWith('uploads/')){base=await realpath(path.resolve('data/uploads'));source=path.resolve(base,b.storageKey.slice(8));}else if(b.storageKey.startsWith('seed/')){base=await realpath(path.resolve('spike/app/public/seed'));source=path.resolve(base,b.storageKey.slice(5));}else throw Error('Unsupported source prefix');source=await realpath(source);const relative=path.relative(base,source);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Refusing source outside designated root');const pdf=await pdfjs.getDocument({data:new Uint8Array(await readFile(source)),isEvalSupported:false,useSystemFonts:true,verbosity:0}).promise;
 try{const report={assetId:b.assetId,totalPages:pdf.numPages,pages:[],scope:'Source structure details only; no article text or publisher page images retained'};reports.push(report);
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number);try{const [tree,text]=await Promise.all([page.getStructTree(),page.getTextContent({includeMarkedContent:true})]),stack=[],nonempty=new Set();for(const item of text.items){if(item.type==='beginMarkedContentProps'||item.type==='beginMarkedContent')stack.push(item.id||null);else if(item.type==='endMarkedContent')stack.pop();else if(item.str?.trim())for(const id of stack)if(id)nonempty.add(id);}
    const row={number,headingLevels:[],tables:0,headerCells:0,cells:0,figures:0,figuresMissingAlt:0,missingAltWithMappedText:0,missingAltWithoutMappedText:0};
    function ids(node,out=[]){if(node.type==='content')out.push(node.id);for(const child of node.children||[])ids(child,out);return out;}
    function visit(node){if(!node)return;if(/^H[1-9]\d*$/.test(node.role||''))row.headingLevels.push(Number(node.role.slice(1)));if(node.role==='Table')row.tables++;if(node.role==='TH')row.headerCells++;if(node.role==='TD')row.cells++;if(node.role==='Figure'){row.figures++;if(!(typeof node.alt==='string'&&node.alt.trim())){row.figuresMissingAlt++;if(ids(node).some(id=>nonempty.has(id)))row.missingAltWithMappedText++;else row.missingAltWithoutMappedText++;}}for(const child of node.children||[])visit(child);}
    visit(tree);report.pages.push(row);
   }finally{page.cleanup();}
  }
  report.totals=report.pages.reduce((out,p)=>{for(const key of ['tables','headerCells','cells','figures','figuresMissingAlt','missingAltWithMappedText','missingAltWithoutMappedText'])out[key]=(out[key]||0)+p[key];return out;},{});
 }finally{await pdf.destroy();}
}
await writeFile('tmp/acr-catalog-v127/structure-detail.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports.map(r=>({assetId:r.assetId,pagesWithHeadings:r.pages.filter(p=>p.headingLevels.length).map(p=>p.number),...r.totals}))));
