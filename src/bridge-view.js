import { fmt } from './ui.js';

export function renderBridgeProfiles(host, parts) {
  if (!host) return;
  host.innerHTML = parts
    .flatMap((part) => {
      const d = part.bridgeDiagram;
      if (!d) return [];
      const x = (t) => (8 + t * 232).toFixed(2);
      const y = (z) => (72 - (59 * z) / (d.rise + d.height)).toFixed(2);
      const road = [
        ...d.path.map(([t, z]) => [t, z + d.height]),
        ...d.path.slice().reverse(),
      ]
        .map(([t, z]) => x(t) + ',' + y(z))
        .join(' ');
      const supports = d.blocks
        .map(
          ([t, z]) =>
            '<path stroke="var(--d-support)" stroke-width="3" d="M' +
            x(t) +
            ' 72V' +
            y(z) +
            '"/>',
        )
        .join('');
      return [
        '<figure class="bridge-profile"><figcaption>Crossing ' +
          d.crossing +
          ' · Side view</figcaption><svg viewBox="0 0 248 82" role="img" aria-label="Upper road, lower road and support positions">' +
          '<path stroke="var(--d-guide)" d="M3 72H245"/>' +
          supports +
          '<rect fill="var(--d-track)" x="' +
          (Number(x(d.at)) - 7) +
          '" y="' +
          y(d.height) +
          '" width="14" height="' +
          (72 - Number(y(d.height))) +
          '"/>' +
          '<polygon fill="var(--d-support)" points="' +
          road +
          '"/></svg><small>' +
          fmt(d.clearance) +
          ' mm clear · ' +
          d.blocks.length +
          ' blocks' +
          (d.grade ? ' · steepest grade ' + fmt(d.grade * 100) + '%' : '') +
          '</small></figure>',
      ];
    })
    .join('');
}
