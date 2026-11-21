/* Runs right after the first Office.js script tag. If that copy could not be loaded (a network, DNS or content filter
 * that blocks the newer Microsoft domain), load Microsoft's long standing address instead. document.write keeps the
 * script in order, so Office.js still finishes loading before any other script runs, as Microsoft requires.
 */
(function (root) {
  "use strict";
  if (root.Office) return;
  var fallback = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
  try {
    root.document.write('<script src="' + fallback + '"><' + "/script>");
    root.__formulrOfficeFallback = true;
  } catch (e) {
    /* nothing more to try; the pane shows a clear message */
  }
})(typeof window !== "undefined" ? window : globalThis);
