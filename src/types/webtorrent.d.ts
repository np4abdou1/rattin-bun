// WebTorrent ships without TypeScript types.
declare module "webtorrent" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebTorrent: any;
  export default WebTorrent;
}
