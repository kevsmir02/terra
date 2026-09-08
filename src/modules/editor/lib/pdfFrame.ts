// WebKitGTK replaces the frame's document with its bundled PDF.js viewer, which
// fetches the PDF back over asset:// using the frame's origin. An opaque origin
// (allow-scripts alone) fails that CORS check and leaves an empty toolbar, so
// the viewer keeps its own origin (still foreign to the app's) and gets no
// navigation or popup grant, so a crafted PDF cannot move the webview off Terra.
export const PDF_FRAME_SANDBOX = "allow-scripts allow-same-origin";
