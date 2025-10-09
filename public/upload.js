const $ = sel => document.querySelector(sel);
const human = b => {
if (!b && b !== 0) return '-';
  const units = ['B','KB','MB','GB','TB'];
let i = 0; while (b >= 1024 && i < units.length-1) { b/=1024; i++; }
return `${b.toFixed(1)} ${units[i]}`;
};
$('#btn').onclick = async () => {
 const file = $('#file').files[0];
 if (!file) { $('#out').textContent = 'Please choose a file first.'; return; }
  $('#out').textContent = 'Requesting presigned URL…';
  $('#fill').style.width = '0%';
 $('#pct').textContent = '0%';
 try {
  // 1) presign
 const r = await fetch('/api/v1/upload/presign', {
  method: 'POST',
 headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
  filename: file.name,
 contentType: file.type || 'application/octet-stream',
 size: file.size
 })
 });
 if (!r.ok) throw new Error('presign failed: ' + r.status);
 const { uploadUrl, fileKey, id } = await r.json();
  $('#out').textContent =
 `Presigned ✓\nfileKey: ${fileKey}\nid: ${id}\nUploading ${human(file.size)}…`;
 // 2) upload to S3 with progress
const xhr = new XMLHttpRequest();
 xhr.open('PUT', uploadUrl, true);
xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
 xhr.upload.onprogress = (ev) => {
  if (ev.lengthComputable) {
 const pct = Math.round((ev.loaded / ev.total) * 100);
 $('#fill').style.width = pct + '%';
  $('#pct').textContent = pct + '%';
 }
};
  xhr.onerror = () => {
 $('#out').textContent = '✗ Network error during upload';
  };
 xhr.onload = () => {
 if (xhr.status === 200) {
 $('#fill').style.width = '100%';
 $('#pct').textContent = '100%';
  $('#out').textContent =
`✅ Uploaded!\nfileKey: ${fileKey}\nid: ${id}\nS3 responded: ${xhr.status}`;
 } else {
 $('#out').textContent =
 `✗ S3 error: ${xhr.status}\n${xhr.responseText || ''}`;
 }
  };
 xhr.send(file);
  } catch (e) {
 $('#out').textContent = '✗ ' + e.message;
 }
};
