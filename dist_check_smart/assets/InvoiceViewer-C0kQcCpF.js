import{c as w,j as t,F as C,X as F,C as B}from"./index-J0CZ7i7g.js";import{r as A}from"./vendor-react-Bp2tFrlt.js";import{D as L}from"./download-B-AYqKYp.js";/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R=[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]],S=w("printer",R),O={TD01:"Fattura",TD02:"Acconto/Anticipo",TD03:"Acconto/Anticipo parcella",TD04:"Nota di credito",TD05:"Nota di debito",TD06:"Parcella",TD16:"Integrazione reverse charge",TD17:"Integrazione acquisti UE",TD20:"Autofattura",TD24:"Fattura differita",TD25:"Fattura differita (art.21 c.6 lett.a)",TD26:"Cessione beni ammortizzabili",TD27:"Fattura autoconsumo/cessioni gratuite"},U={MP01:"Contanti",MP02:"Assegno",MP03:"Assegno circolare",MP04:"Contanti presso Tesoreria",MP05:"Bonifico",MP06:"Vaglia cambiario",MP07:"Bollettino bancario",MP08:"Carta di pagamento",MP09:"RID",MP10:"RID utenze",MP11:"RID veloce",MP12:"RIBA",MP13:"MAV",MP14:"Quietanza erario",MP15:"Giroconto su conti di contabilità speciale",MP16:"Domiciliazione bancaria",MP17:"Domiciliazione postale",MP18:"Bollettino di c/c postale",MP19:"SEPA Direct Debit",MP20:"SEPA Direct Debit CORE",MP21:"SEPA Direct Debit B2B",MP22:"Trattenuta su somme già riscosse",MP23:"PagoPA"};function d(o){if(o==null||o==="")return"—";const s=parseFloat(String(o).replace(",","."));return isNaN(s)?String(o):new Intl.NumberFormat("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2}).format(s)}function P(o){if(!o)return"—";const s=o.split("-");return s.length===3?`${s[2]}/${s[1]}/${s[0]}`:o}function e(o,s){var p;if(!o)return"";const n=o.getElementsByTagName(s)[0];return((p=n==null?void 0:n.textContent)==null?void 0:p.trim())??""}function I(o,s){return o?Array.from(o.getElementsByTagName(s)):[]}function k(o){const n=new DOMParser().parseFromString(o,"text/xml");if(n.querySelector("parsererror"))throw new Error("XML non valido");const h=n.getElementsByTagName("FatturaElettronicaBody")[0]||n.getElementsByTagName("p:FatturaElettronicaBody")[0],l=n.getElementsByTagName("FatturaElettronicaHeader")[0]||n.getElementsByTagName("p:FatturaElettronicaHeader")[0];if(!h&&!l)throw new Error("Struttura FatturaPA non riconosciuta");const m=l==null?void 0:l.getElementsByTagName("CedentePrestatore")[0],b=m==null?void 0:m.getElementsByTagName("DatiAnagrafici")[0],c=m==null?void 0:m.getElementsByTagName("Sede")[0],a={denominazione:e(b,"Denominazione")||`${e(b,"Nome")} ${e(b,"Cognome")}`.trim(),partitaIva:e(b,"IdCodice"),codiceFiscale:e(b,"CodiceFiscale"),indirizzo:e(c,"Indirizzo"),cap:e(c,"CAP"),comune:e(c,"Comune"),provincia:e(c,"Provincia"),nazione:e(c,"Nazione")},i=l==null?void 0:l.getElementsByTagName("CessionarioCommittente")[0],u=i==null?void 0:i.getElementsByTagName("DatiAnagrafici")[0],N=i==null?void 0:i.getElementsByTagName("Sede")[0],j={denominazione:e(u,"Denominazione")||`${e(u,"Nome")} ${e(u,"Cognome")}`.trim(),partitaIva:e(u,"IdCodice"),codiceFiscale:e(u,"CodiceFiscale"),indirizzo:e(N,"Indirizzo"),cap:e(N,"CAP"),comune:e(N,"Comune"),provincia:e(N,"Provincia")},g=h==null?void 0:h.getElementsByTagName("DatiGeneraliDocumento")[0],z=e(g,"TipoDocumento"),T={tipo:z,tipoLabel:O[z]||z,numero:e(g,"Numero"),data:e(g,"Data"),divisa:e(g,"Divisa")||"EUR",importoTotale:e(g,"ImportoTotaleDocumento"),causale:e(g,"Causale")},y=h==null?void 0:h.getElementsByTagName("DatiBeniServizi")[0],D=I(y,"DettaglioLinee").map(x=>({numero:e(x,"NumeroLinea"),descrizione:e(x,"Descrizione"),quantita:e(x,"Quantita"),unitaMisura:e(x,"UnitaMisura"),prezzoUnitario:e(x,"PrezzoUnitario"),prezzoTotale:e(x,"PrezzoTotale"),aliquotaIva:e(x,"AliquotaIVA")})),$=I(y,"DatiRiepilogo").map(x=>({aliquota:e(x,"AliquotaIVA"),imponibile:e(x,"ImponibileImporto"),imposta:e(x,"Imposta"),natura:e(x,"Natura"),esigibilita:e(x,"EsigibilitaIVA")})),r=I(h,"DatiPagamento"),f=[];for(const x of r){const E=e(x,"CondizioniPagamento"),M=I(x,"DettaglioPagamento");for(const v of M)f.push({condizioni:E,modalita:e(v,"ModalitaPagamento"),modalitaLabel:U[e(v,"ModalitaPagamento")]||e(v,"ModalitaPagamento"),scadenza:e(v,"DataScadenzaPagamento"),importo:e(v,"ImportoPagamento"),iban:e(v,"IBAN"),istituto:e(v,"IstitutoFinanziario")})}return{fornitore:a,cliente:j,documento:T,linee:D,riepilogo:$,pagamento:f}}function V({data:o}){const{fornitore:s,cliente:n,documento:p,linee:h,riepilogo:l,pagamento:m}=o,b=l.reduce((a,i)=>a+parseFloat(i.imponibile||"0"),0),c=l.reduce((a,i)=>a+parseFloat(i.imposta||"0"),0);return t.jsxs("div",{className:"space-y-6 text-sm",children:[t.jsxs("div",{className:"text-center border-b pb-4",children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase tracking-wider",children:p.tipoLabel}),t.jsxs("div",{className:"text-xl font-bold text-slate-900 mt-1",children:["N. ",p.numero]}),t.jsxs("div",{className:"text-sm text-slate-600",children:["Data: ",P(p.data)]})]}),t.jsxs("div",{className:"grid grid-cols-2 gap-6",children:[t.jsxs("div",{className:"bg-slate-50 rounded-lg p-4",children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase font-semibold mb-2",children:"Cedente / Prestatore"}),t.jsx("div",{className:"font-semibold text-slate-900",children:s.denominazione}),s.partitaIva&&t.jsxs("div",{className:"text-xs text-slate-600 mt-1",children:["P.IVA: ",s.partitaIva]}),s.codiceFiscale&&t.jsxs("div",{className:"text-xs text-slate-600",children:["CF: ",s.codiceFiscale]}),s.indirizzo&&t.jsxs("div",{className:"text-xs text-slate-500 mt-1",children:[s.indirizzo,", ",s.cap," ",s.comune," ",s.provincia&&`(${s.provincia})`]})]}),t.jsxs("div",{className:"bg-slate-50 rounded-lg p-4",children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase font-semibold mb-2",children:"Cessionario / Committente"}),t.jsx("div",{className:"font-semibold text-slate-900",children:n.denominazione}),n.partitaIva&&t.jsxs("div",{className:"text-xs text-slate-600 mt-1",children:["P.IVA: ",n.partitaIva]}),n.codiceFiscale&&t.jsxs("div",{className:"text-xs text-slate-600",children:["CF: ",n.codiceFiscale]}),n.indirizzo&&t.jsxs("div",{className:"text-xs text-slate-500 mt-1",children:[n.indirizzo,", ",n.cap," ",n.comune," ",n.provincia&&`(${n.provincia})`]})]})]}),h.length>0&&t.jsxs("div",{children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase font-semibold mb-2",children:"Dettaglio beni/servizi"}),t.jsxs("table",{className:"w-full text-xs border-collapse",children:[t.jsx("thead",{children:t.jsxs("tr",{className:"bg-slate-100",children:[t.jsx("th",{className:"text-left p-2 font-semibold",children:"#"}),t.jsx("th",{className:"text-left p-2 font-semibold",children:"Descrizione"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Qtà"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Prezzo un."}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Totale"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"IVA %"})]})}),t.jsx("tbody",{children:h.map((a,i)=>t.jsxs("tr",{className:"border-b border-slate-100",children:[t.jsx("td",{className:"p-2 text-slate-400",children:a.numero||i+1}),t.jsx("td",{className:"p-2 text-slate-800 max-w-[300px]",children:a.descrizione}),t.jsx("td",{className:"p-2 text-right text-slate-600",children:a.quantita||"—"}),t.jsx("td",{className:"p-2 text-right text-slate-600",children:d(a.prezzoUnitario)}),t.jsx("td",{className:"p-2 text-right font-medium text-slate-900",children:d(a.prezzoTotale)}),t.jsxs("td",{className:"p-2 text-right text-slate-600",children:[d(a.aliquotaIva),"%"]})]},i))})]})]}),l.length>0&&t.jsxs("div",{children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase font-semibold mb-2",children:"Riepilogo IVA"}),t.jsxs("table",{className:"w-full text-xs border-collapse",children:[t.jsx("thead",{children:t.jsxs("tr",{className:"bg-slate-100",children:[t.jsx("th",{className:"text-left p-2 font-semibold",children:"Aliquota"}),t.jsx("th",{className:"text-left p-2 font-semibold",children:"Natura"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Imponibile"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Imposta"})]})}),t.jsx("tbody",{children:l.map((a,i)=>t.jsxs("tr",{className:"border-b border-slate-100",children:[t.jsxs("td",{className:"p-2",children:[d(a.aliquota),"%"]}),t.jsx("td",{className:"p-2 text-slate-600",children:a.natura||"—"}),t.jsx("td",{className:"p-2 text-right",children:d(a.imponibile)}),t.jsx("td",{className:"p-2 text-right",children:d(a.imposta)})]},i))}),t.jsx("tfoot",{children:t.jsxs("tr",{className:"bg-slate-50 font-semibold",children:[t.jsx("td",{className:"p-2",colSpan:2,children:"Totale"}),t.jsx("td",{className:"p-2 text-right",children:d(b)}),t.jsx("td",{className:"p-2 text-right",children:d(c)})]})})]})]}),t.jsx("div",{className:"flex justify-end",children:t.jsxs("div",{className:"bg-blue-50 rounded-lg px-6 py-3 text-right",children:[t.jsx("div",{className:"text-xs text-blue-600 uppercase",children:"Totale documento"}),t.jsxs("div",{className:"text-2xl font-bold text-blue-900",children:[d(p.importoTotale)," ",p.divisa]})]})}),m.length>0&&t.jsxs("div",{children:[t.jsx("div",{className:"text-xs text-slate-500 uppercase font-semibold mb-2",children:"Dati pagamento"}),m.length>1&&t.jsxs("p",{className:"text-xs text-slate-500 mb-2",children:["Pagamento in ",m.length," rate"]}),t.jsxs("table",{className:"w-full text-xs border-collapse",children:[t.jsx("thead",{children:t.jsxs("tr",{className:"bg-slate-100",children:[m.length>1&&t.jsx("th",{className:"text-left p-2 font-semibold",children:"Rata"}),t.jsx("th",{className:"text-left p-2 font-semibold",children:"Modalità"}),t.jsx("th",{className:"text-left p-2 font-semibold",children:"Scadenza"}),t.jsx("th",{className:"text-right p-2 font-semibold",children:"Importo"}),t.jsx("th",{className:"text-left p-2 font-semibold",children:"IBAN"})]})}),t.jsx("tbody",{children:m.map((a,i)=>t.jsxs("tr",{className:"border-b border-slate-100",children:[m.length>1&&t.jsxs("td",{className:"p-2 text-slate-600",children:[i+1,"/",m.length]}),t.jsx("td",{className:"p-2 font-medium",children:a.modalitaLabel}),t.jsx("td",{className:"p-2 font-medium",children:P(a.scadenza)}),t.jsxs("td",{className:"p-2 text-right font-medium",children:[d(a.importo)," EUR"]}),t.jsx("td",{className:"p-2 font-mono text-[11px]",children:a.iban||"—"})]},i))})]})]}),p.causale&&t.jsxs("div",{className:"text-xs text-slate-500 italic border-t pt-3",children:["Causale: ",p.causale]})]})}function _({xmlContent:o,onClose:s,autoPrint:n=!1}){const[p,h]=A.useState(null),l=A.useMemo(()=>{if(!o)return null;try{return k(o)}catch(c){return h(c.message),null}},[o]);A.useEffect(()=>{if(n&&l){const c=setTimeout(()=>m(),150);return()=>clearTimeout(c)}},[n,l]);const m=()=>{if(!l)return;const c=window.open("","_blank");if(!c)return;const{fornitore:a,cliente:i,documento:u,linee:N,riepilogo:j,pagamento:g}=l,z=j.reduce((r,f)=>r+parseFloat(f.imponibile||"0"),0),T=j.reduce((r,f)=>r+parseFloat(f.imposta||"0"),0),y=N.map(r=>`
      <tr>
        <td style="text-align:center">${r.numero||""}</td>
        <td>${r.descrizione||""}</td>
        <td style="text-align:center">${r.quantita||"—"}</td>
        <td style="text-align:right">${d(r.prezzoUnitario)}</td>
        <td style="text-align:right">${d(r.prezzoTotale)}</td>
        <td style="text-align:center">${d(r.aliquotaIva)}%</td>
      </tr>
    `).join(""),D=j.map(r=>`
      <tr>
        <td>${d(r.aliquota)}%</td>
        <td>${r.natura||"—"}</td>
        <td style="text-align:right">${d(r.imponibile)}</td>
        <td style="text-align:right">${d(r.imposta)}</td>
      </tr>
    `).join(""),$=g.map((r,f)=>`
      <tr>
        ${g.length>1?`<td>${f+1}/${g.length}</td>`:""}
        <td>${r.modalitaLabel}</td>
        <td>${P(r.scadenza)}</td>
        <td style="text-align:right;font-weight:bold">${d(r.importo)} EUR</td>
        <td style="font-family:monospace;font-size:8pt">${r.iban||"—"}</td>
      </tr>
    `).join("");c.document.write(`<!DOCTYPE html><html><head>
      <title>Fattura ${u.numero}</title>
      <style>
        @page { size: A4; margin: 15mm 20mm; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #333; line-height: 1.4; }
        .title { text-align: center; margin: 20px 0; }
        .title h1 { font-size: 16pt; color: #1e40af; margin: 0; }
        .title .subtitle { font-size: 11pt; color: #555; }
        .parties { display: flex; gap: 30px; margin-bottom: 20px; }
        .party { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 4px; }
        .party-label { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 1px; margin-bottom: 6px; }
        .party-name { font-weight: bold; font-size: 11pt; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background-color: #f0f4ff; padding: 8px 6px; text-align: left; font-size: 8pt; text-transform: uppercase; color: #555; border-bottom: 2px solid #2563eb; }
        td { padding: 6px; border-bottom: 1px solid #eee; font-size: 9pt; }
        .section-title { font-size: 10pt; font-weight: bold; color: #1e40af; margin-top: 20px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
        .totale-box { float: right; background: #1e40af; color: white; padding: 12px 24px; border-radius: 6px; text-align: center; margin-top: 15px; }
        .totale-box .label { font-size: 8pt; text-transform: uppercase; opacity: 0.8; }
        .totale-box .amount { font-size: 16pt; font-weight: bold; }
        .clearfix::after { content: ""; display: table; clear: both; }
        .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8pt; color: #999; text-align: center; }
      </style>
    </head><body>
      <div class="title">
        <h1>${u.tipoLabel||"FATTURA"}</h1>
        <div class="subtitle">N. ${u.numero}</div>
        <div class="subtitle">Data: ${P(u.data)}</div>
      </div>
      <div class="parties">
        <div class="party">
          <div class="party-label">Cedente / Prestatore</div>
          <div class="party-name">${a.denominazione}</div>
          ${a.partitaIva?`<div style="font-size:9pt">P.IVA: ${a.partitaIva}</div>`:""}
          ${a.codiceFiscale?`<div style="font-size:9pt">CF: ${a.codiceFiscale}</div>`:""}
          ${a.indirizzo?`<div style="font-size:8pt;color:#666">${a.indirizzo}, ${a.cap} ${a.comune} ${a.provincia?`(${a.provincia})`:""}</div>`:""}
        </div>
        <div class="party">
          <div class="party-label">Cessionario / Committente</div>
          <div class="party-name">${i.denominazione}</div>
          ${i.partitaIva?`<div style="font-size:9pt">P.IVA: ${i.partitaIva}</div>`:""}
          ${i.indirizzo?`<div style="font-size:8pt;color:#666">${i.indirizzo}, ${i.cap} ${i.comune} ${i.provincia?`(${i.provincia})`:""}</div>`:""}
        </div>
      </div>
      <div class="section-title">DETTAGLIO BENI/SERVIZI</div>
      <table>
        <thead><tr>
          <th style="text-align:center">#</th><th>Descrizione</th><th style="text-align:center">Qtà</th>
          <th style="text-align:right">Prezzo un.</th><th style="text-align:right">Totale</th><th style="text-align:center">IVA %</th>
        </tr></thead>
        <tbody>${y}</tbody>
      </table>
      <div class="section-title">RIEPILOGO IVA</div>
      <table>
        <thead><tr><th>Aliquota</th><th>Natura</th><th style="text-align:right">Imponibile</th><th style="text-align:right">Imposta</th></tr></thead>
        <tbody>${D}
          <tr style="border-top:2px solid #333"><td colspan="2" style="font-weight:bold">Totale</td>
          <td style="text-align:right;font-weight:bold">${d(z)}</td>
          <td style="text-align:right;font-weight:bold">${d(T)}</td></tr>
        </tbody>
      </table>
      <div class="clearfix">
        <div class="totale-box">
          <div class="label">TOTALE DOCUMENTO</div>
          <div class="amount">${d(u.importoTotale)} ${u.divisa}</div>
        </div>
      </div>
      <div style="clear:both"></div>
      <div class="section-title">DATI PAGAMENTO</div>
      ${g.length>1?`<p style="font-size:9pt;color:#666;margin-bottom:8px">Pagamento in ${g.length} rate</p>`:""}
      <table>
        <thead><tr>
          ${g.length>1?"<th>Rata</th>":""}
          <th>Modalità</th><th>Scadenza</th><th style="text-align:right">Importo</th><th>IBAN</th>
        </tr></thead>
        <tbody>${$}</tbody>
      </table>
      <div class="footer">Documento generato dal gestionale</div>
      <script>window.onload = function() { window.print(); };<\/script>
    </body></html>`),c.document.close()},b=()=>{var i;if(!o)return;const c=new Blob([o],{type:"application/xml"}),a=document.createElement("a");a.href=URL.createObjectURL(c),a.download=`fattura_${((i=l==null?void 0:l.documento)==null?void 0:i.numero)||"xml"}.xml`,a.click(),URL.revokeObjectURL(a.href)};return o?t.jsx("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/40",onClick:s,children:t.jsxs("div",{className:"bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden mx-4 flex flex-col",onClick:c=>c.stopPropagation(),children:[t.jsxs("div",{className:"flex items-center justify-between px-5 py-3 border-b bg-slate-50 rounded-t-xl flex-shrink-0",children:[t.jsxs("div",{className:"flex items-center gap-2 text-sm font-medium text-slate-700",children:[t.jsx(C,{size:16,className:"text-blue-600"}),"Anteprima Fattura"]}),t.jsxs("div",{className:"flex items-center gap-2",children:[t.jsxs("button",{onClick:m,className:"flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition",children:[t.jsx(S,{size:13})," Stampa / PDF"]}),t.jsxs("button",{onClick:b,className:"flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition",children:[t.jsx(L,{size:13})," XML"]}),t.jsx("button",{onClick:s,className:"p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition",children:t.jsx(F,{size:18})})]})]}),t.jsx("div",{className:"overflow-y-auto flex-1 p-6",id:"invoice-render-area",children:p?t.jsxs("div",{className:"flex items-center gap-3 p-4 bg-red-50 text-red-700 rounded-lg",children:[t.jsx(B,{size:18}),t.jsxs("div",{children:[t.jsx("div",{className:"font-medium",children:"Impossibile visualizzare la fattura"}),t.jsx("div",{className:"text-xs mt-1",children:p})]})]}):l?t.jsx(V,{data:l}):t.jsx("div",{className:"text-center py-8 text-slate-400",children:"Nessun contenuto XML disponibile"})})]})}):null}export{_ as I,S as P};
