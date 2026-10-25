
import fs from "node:fs";
import { db } from "./db.js";

fs.mkdirSync("site", { recursive: true });

const companies = db.prepare(
  "SELECT * FROM companies ORDER BY country,name"
).all();

const jobs = db.prepare(
  "SELECT * FROM jobs ORDER BY last_seen DESC"
).all();

const payload = JSON.stringify({ companies, jobs })
  .replace(/</g, "\\u003c");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Victor | Oil & Gas Job Search</title>
<style>
body{font-family:system-ui;background:#f3f6fa;color:#172b45;margin:0}
header{background:#102d4d;color:white;padding:32px}
main{max-width:1100px;margin:25px auto;padding:0 18px}
nav button{padding:12px 20px;border:0;cursor:pointer;margin:4px;border-radius:7px}
nav button.active{background:#1463a5;color:white}
article{background:white;padding:20px;margin:12px 0;border-radius:12px;border:1px solid #ddd}
input,select{padding:12px;margin:10px 4px;border:1px solid #ccc;border-radius:7px}
a{color:#1264aa}
small{color:#667}
</style>
</head>
<body>
<header>
<h1>Oil & Gas Project Engineering Opportunities</h1>
<p>International company and job research</p>
</header>
<main>
<nav>
<button onclick="tab('jobs')" id="jobsBtn">Jobs</button>
<button onclick="tab('companies')" id="companiesBtn">Companies</button>
<button onclick="tab('email')" id="emailBtn">Email</button>
</nav>
<input id="search" placeholder="Search..." oninput="render()">
<select id="country" onchange="render()">
<option value="">All countries</option>
</select>
<div id="results"></div>
</main>
<script>
const data=${payload};
let current="jobs";

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({
"&":"&amp;","<":"&lt;",">":"&gt;",
'"':"&quot;","'":"&#39;"
}[c]));

const link=(u,t)=>/^https?:\\/\\//.test(u||"")
?'<a target="_blank" rel="noopener noreferrer" href="'+esc(u)+'">'+esc(t)+'</a>'
:esc(t);

for(const c of [...new Set(data.companies.map(x=>x.country))]){
const o=document.createElement("option");
o.value=c;o.textContent=c;
document.querySelector("#country").append(o);
}

function tab(t){current=t;render()}

function render(){
for(const t of ["jobs","companies","email"])
document.getElementById(t+"Btn").classList.toggle("active",t===current);

const q=document.querySelector("#search").value.toLowerCase();
const country=document.querySelector("#country").value;
let html="";

if(current==="companies"){
html=data.companies.filter(c=>
(!country||c.country===country)&&
(c.name+" "+c.country).toLowerCase().includes(q)
).map(c=>'<article><h3>'+esc(c.name)+'</h3><p>'+
esc(c.country)+'</p><p>'+link(c.website,"Website")+
' | '+link(c.careers_url,"Careers")+'</p><p>Company quote: '+
esc(c.fact)+'</p><small>Source: '+
link(c.fact_url,c.fact_url)+'</small></article>').join("");
}

if(current==="jobs"){
html=data.jobs.filter(j=>{
const c=data.companies.find(x=>x.id===j.company_id);
return c&&(!country||c.country===country)&&
(j.title+" "+c.name).toLowerCase().includes(q);
}).map(j=>{
const c=data.companies.find(x=>x.id===j.company_id);
return '<article><h3>'+esc(j.title)+'</h3><p>'+
esc(c.name)+' — '+esc(c.country)+'</p>'+
link(j.url,"Official job link")+
'<p><small>Last observed: '+esc(j.last_seen)+
' | Foreign applicant eligibility: '+esc(j.foreigner_eligibility)+
'</small></p></article>';
}).join("");
}

if(current==="email"){
html='<article><h2>Private application drafts</h2>'+
'<p>Drafts are generated locally using npm run export.</p>'+
'<p>They are not published on this public website.</p>'+
'<p>Check Gmail Sent and the local sent log before sending manually.</p>'+
'</article>';
}

document.querySelector("#results").innerHTML=
html||"<p>No matching records yet.</p>";
}
render();
</script>
</body>
</html>`;

fs.writeFileSync("site/index.html", html);
console.log("Public dashboard built.");
db.close();
