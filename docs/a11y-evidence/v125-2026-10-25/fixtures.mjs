import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('spike/app/package.json'));
const JSZip=require('jszip');
const {PDFDocument,PDFName,PDFOperator,PDFString,StandardFonts,rgb}=require('pdf-lib');
async function packageEpub({fixed=false,chapters}){
 const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 const names=Object.keys(chapters);
 zip.file('EPUB/package.opf',`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">a11y-fixture-${fixed?'fixed':'semantic'}</dc:identifier><dc:title>Accessibility fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-25T00:00:00Z</meta>${fixed?'<meta property="rendition:layout">pre-paginated</meta>':''}</metadata><manifest>${names.map((n,i)=>`<item id="c${i}" href="${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="triangle" href="triangle.svg" media-type="image/svg+xml"/></manifest><spine>${names.map((n,i)=>`<itemref idref="c${i}"/>`).join('')}</spine></package>`);
 for(const [name,body]of Object.entries(chapters))zip.file(`EPUB/${name}.xhtml`,`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${name}</title>${fixed?'<meta name="viewport" content="width=600, height=800"/>':''}</head><body${fixed?' style="width:600px;height:800px;margin:0"':''}>${body}</body></html>`);
 zip.file('EPUB/nav.xhtml',`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Contents</title></head><body><nav epub:type="toc" aria-label="Contents"><ol>${names.map(n=>`<li><a href="${n}.xhtml">${n}</a></li>`).join('')}</ol></nav></body></html>`);
 zip.file('EPUB/triangle.svg','<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180"><path d="M20 160 L220 160 L220 20 Z" fill="none" stroke="black" stroke-width="4"/><text x="110" y="178">a</text><text x="224" y="100">b</text><text x="100" y="72">c</text></svg>');
 return zip.generateAsync({type:'nodebuffer'});
}
export function semanticEpub(){return packageEpub({chapters:{
 'academic':'<h1>Structured academic content</h1><p>Research reading fixture.</p><h2>Study results</h2><table><caption>Participants by group</caption><thead><tr><th scope="col">Group</th><th scope="col">Count</th></tr></thead><tbody><tr><th scope="row">A</th><td>12</td></tr></tbody></table><figure><img src="triangle.svg" alt="Right triangle with sides a, b and c"/><figcaption>Geometry example.</figcaption></figure><p>Theorem: <math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>z</mi><mn>2</mn></msup></mrow></math></p><p><a epub:type="noteref" href="#fn1">Footnote one</a></p><aside id="fn1" epub:type="footnote"><p>This is the source reference.</p></aside>',
 'rtl':'<h1>RTL sample</h1><section lang="ar" dir="rtl"><h2>مثال عربي</h2><p>هذا مثال للقراءة من اليمين إلى اليسار.</p><p>الصفحة ١٢ والمرجع ٣.</p></section><p lang="tr">Türkçe açıklama örneği.</p>'
}});}
export function fixedEpub(){return packageEpub({fixed:true,chapters:{
 'fixed-one':'<h1 style="position:absolute;left:32px;top:20px">Fixed page one</h1><p style="position:absolute;left:32px;top:100px">Fixed layout test page.</p><img style="position:absolute;left:70px;top:200px" src="triangle.svg" alt="Right triangle with sides a, b and c"/>',
 'fixed-two':'<h1>Fixed page two</h1><p>Second fixed-layout page.</p>'
}});}
export async function pdfFixtures(scanPng){
 const make=async()=>{const d=await PDFDocument.create();d.setCreationDate(new Date('2026-10-25T00:00:00Z'));d.setModificationDate(new Date('2026-10-25T00:00:00Z'));return d;};
 const tagged=await make(),font=await tagged.embedFont(StandardFonts.Helvetica),page=tagged.addPage([600,800]);
 const ctx=tagged.context,root=ctx.obj({Type:'StructTreeRoot'}),rootRef=ctx.register(root),elements=[];
 function marked(role,text,x,y,size=16,alt){const index=elements.length;page.pushOperators(PDFOperator.of('BDC',[PDFName.of(role),ctx.obj({MCID:index})]));page.drawText(text,{x,y,size,font});page.pushOperators(PDFOperator.of('EMC'));const entry=ctx.obj({Type:'StructElem',S:role,P:rootRef,Pg:page.ref,K:index});if(alt)entry.set(PDFName.of('Alt'),PDFString.of(alt));elements.push(ctx.register(entry));}
 marked('H1','Tagged PDF heading',40,730,24);marked('P','Tagged PDF paragraph.',40,680);marked('Formula','x^2 + y^2 = z^2',40,620,18,'x squared plus y squared equals z squared');
 root.set(PDFName.of('K'),ctx.obj(elements));root.set(PDFName.of('ParentTree'),ctx.register(ctx.obj({Nums:[0,elements]})));root.set(PDFName.of('ParentTreeNextKey'),ctx.obj(1));page.node.set(PDFName.of('StructParents'),ctx.obj(0));tagged.catalog.set(PDFName.of('StructTreeRoot'),rootRef);tagged.catalog.set(PDFName.of('MarkInfo'),ctx.obj({Marked:true}));tagged.catalog.set(PDFName.of('Lang'),PDFString.of('en'));
 const columns=await make(),cf=await columns.embedFont(StandardFonts.Helvetica),cp=columns.addPage([600,800]);cp.drawText('RIGHT SECOND',{x:330,y:720,size:18,font:cf});cp.drawText('LEFT FIRST',{x:40,y:720,size:18,font:cf});
 const scan=await make(),sp=scan.addPage([600,800]),image=await scan.embedPng(scanPng);sp.drawImage(image,{x:40,y:600,width:520,height:120});
 return{'tagged-structure.pdf':Buffer.from(await tagged.save()),'untagged-columns.pdf':Buffer.from(await columns.save()),'image-only.pdf':Buffer.from(await scan.save())};
}
