import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const require=createRequire(path.resolve('spike/app/package.json')),{createCanvas}=require('@napi-rs/canvas'),pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
const inventory=JSON.parse(await readFile('tmp/acr-catalog-v127/inventory.json','utf8')),root='tmp/acr-catalog-v127/visual';await mkdir(root,{recursive:true});const report={scope:'Local AI visual source review only; publisher page images stay in ignored tmp, not committed',entries:[]};
for(const b of inventory.entries){
 if(b.format!=='pdf')continue;let base,source;if(b.storageKey.startsWith('uploads/')){base=await realpath(path.resolve('data/uploads'));source=path.resolve(base,b.storageKey.slice(8));}else if(b.storageKey.startsWith('seed/')){base=await realpath(path.resolve('spike/app/public/seed'));source=path.resolve(base,b.storageKey.slice(5));}else throw Error('Unsupported source prefix');source=await realpath(source);const relative=path.relative(base,source);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Refusing source outside designated root');const pdf=await pdfjs.getDocument({data:new Uint8Array(await readFile(source)),isEvalSupported:false,useSystemFonts:true,verbosity:0}).promise;
 try{
  const tileWidth=310,tileHeight=445,columns=4,sheet=createCanvas(tileWidth*columns,Math.ceil(pdf.numPages/columns)*tileHeight),sc=sheet.getContext('2d');sc.fillStyle='#ddd';sc.fillRect(0,0,sheet.width,sheet.height);const entry={assetId:b.assetId,pages:[]};report.entries.push(entry);
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number);try{const viewport=page.getViewport({scale:1.25}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const name=`${b.assetId}-page-${String(number).padStart(3,'0')}.png`;await writeFile(root+'/'+name,canvas.toBuffer('image/png'));const x=((number-1)%columns)*tileWidth,y=Math.floor((number-1)/columns)*tileHeight;sc.fillStyle='#111';sc.font='15px Arial';sc.fillText('PDF page '+number,x+8,y+18);const scale=Math.min((tileWidth-12)/canvas.width,(tileHeight-30)/canvas.height);sc.drawImage(canvas,x+6,y+25,canvas.width*scale,canvas.height*scale);entry.pages.push({number,file:name});canvas.width=1;canvas.height=1;}finally{page.cleanup();}
  }
  entry.contactSheet=b.assetId+'-contact.png';await writeFile(root+'/'+entry.contactSheet,sheet.toBuffer('image/png'));sheet.width=1;sheet.height=1;console.log(JSON.stringify({assetId:b.assetId,pages:pdf.numPages,contactSheet:entry.contactSheet}));
 }finally{await pdf.destroy();}
}
await writeFile(root+'/rendering.json',JSON.stringify(report,null,2)+'\n');
