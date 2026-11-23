import"./chunk-E3BZXPFN.js";import"./chunk-BAST3UWF.js";import"./chunk-E6GBAZSK.js";import"./chunk-XJGBVDZY.js";import"./chunk-EHYR2IH7.js";import"./chunk-EXNVMYRU.js";import"./chunk-M2HQ6XNY.js";import{C as a,M as p,t as c,w as m}from"./chunk-4FSQUPU3.js";import"./chunk-7YSPBAD3.js";import"./chunk-HKNKX7ZP.js";import"./chunk-NSRW65LP.js";import"./chunk-Y5U5VU4E.js";import"./chunk-DYLCQB6L.js";import"./chunk-LJK7FUK3.js";import"./chunk-4HJ74GQE.js";import"./chunk-I6SR7HBW.js";import"./chunk-QJOUJKFP.js";import"./chunk-V3I7JEPO.js";import"./chunk-IM3BSWBF.js";var w=c`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var u=function(o,e,i,r){var l=arguments.length,t=l<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(o,e,i,r);else for(var f=o.length-1;f>=0;f--)(n=o[f])&&(t=(l<3?n(t):l>3?n(e,i,t):n(e,i))||t);return l>3&&t&&Object.defineProperty(e,i,t),t},s=class extends a{render(){return m`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};s.styles=w;s=u([p("w3m-transactions-view")],s);export{s as W3mTransactionsView};
