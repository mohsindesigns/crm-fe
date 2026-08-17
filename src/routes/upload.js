const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const apiKeyAuth = require('../middleware/auth');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

const ALLOWED_TYPES = new Set(
  (
    process.env.ALLOWED_TYPES ||
    [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'application/pdf',
      'video/mp4', 'video/webm',
      // Voice notes (browser MediaRecorder) + common audio uploads
      'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
      'audio/x-wav', 'audio/aac', 'audio/mp3',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      // HTML deliverables (templates, exported reports). Served as a forced
      // download, never inline — see the Content-Disposition rule in app.js.
      'text/html',
      // Zip archives. Browsers and OSes disagree on the MIME for a .zip, so all
      // the common spellings are listed — otherwise the same file uploads from
      // Chrome and fails from Safari or Windows.
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip',
      'multipart/x-zip',
    ].join(',')
  )
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
);

function baseMime(mimetype) {
  // Browsers often send "audio/webm;codecs=opus" — allowlist matches the type only.
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

/**
 * Whether a generic `application/octet-stream` upload should be let through.
 *
 * Some browsers and OS combinations send a .zip with no recognised MIME at all.
 * Adding octet-stream to ALLOWED_TYPES would have fixed that by gutting the
 * allowlist — every unidentified file (.exe, .sh, .js) arrives as octet-stream,
 * so the whitelist would stop meaning anything. Instead the generic type is
 * accepted only when the filename itself says .zip.
 */
const OCTET_STREAM_EXTENSIONS = /\.zip$/i;
function isAllowedUpload(mime, originalName) {
  if (ALLOWED_TYPES.has(mime)) return true;
  if (mime === 'application/octet-stream') return OCTET_STREAM_EXTENSIONS.test(String(originalName || ''));
  return false;
}

// POST /upload — upload a single file, returns public URL
router.post('/', apiKeyAuth, (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
  }

  const file = req.files.file;
  const mime = baseMime(file.mimetype);

  if (!isAllowedUpload(mime, file.name)) {
    return res.status(415).json({ error: `MIME type "${file.mimetype}" is not allowed` });
  }

  // Use UUID for the stored filename to avoid collisions and path traversal
  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, '') || '';
  const filename = `${uuidv4()}${ext}`;
  const destPath = path.join(UPLOAD_DIR, filename);

  file.mv(destPath, (err) => {
    if (err) {
      console.error('[upload] mv error:', err);
      return res.status(500).json({ error: 'Failed to save file' });
    }

    const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
    res.status(201).json({
      url: `${BASE_URL}/files/${filename}`,
      filename,
      originalName: file.name,
      size: file.size,
      mimetype: file.mimetype,
    });
  });
});

// DELETE /upload/:filename — permanently delete a stored file
router.delete('/:filename', apiKeyAuth, (req, res) => {
  // path.basename prevents directory traversal (strips any ../ etc.)
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('[upload] unlink error:', err);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
    res.json({ message: 'File deleted' });
  });
});

module.exports = router;
