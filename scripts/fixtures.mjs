import {mkdirSync,writeFileSync} from 'node:fs';
import {demoDocument} from '../src/model.mjs';
import {toFilm} from '../src/projection.mjs';
mkdirSync('dist/fixtures',{recursive:true});
for(const kind of ['product','lesson','brand']){const doc=demoDocument(kind);writeFileSync(`dist/fixtures/${kind}.film.json`,JSON.stringify(toFilm(doc),null,2)+'\n');}
