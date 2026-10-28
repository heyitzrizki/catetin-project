import { t } from '@/lib/i18n';

const rows = [
  ['Berkas audio', 'Dibuka di browser perangkatmu', 'Dikirim ke server untuk diproses'],
  ['Transkripsi otomatis', 'Whisper berjalan langsung di perangkat', 'Umumnya diproses di server penyedia'],
  ['Penyimpanan naskah', 'Disimpan di penyimpanan browser perangkatmu', 'Mengikuti kebijakan dan pengaturan penyedia'],
  ['Berbagi & kolaborasi', 'Bagikan sendiri berkas hasil ekspor', 'Sebagian layanan mendukung kolaborasi akun'],
  ['Kebutuhan perangkat', 'Pemutar, editor, dan model memakai perangkatmu', 'Transkripsi diproses di server penyedia'],
  ['Koneksi internet', 'Diperlukan untuk unduhan awal aplikasi dan model', 'Diperlukan untuk mengirim audio dan mengakses layanan'],
] as const;

export function ComparisonSection() {
  return <section className="lp-compare comparison-section page-container scroll-reveal" aria-labelledby="compare-title">
    <div className="lp-section-head">
      <div><p className="eyebrow">{t('LOKAL ATAU CLOUD')}</p><h2 id="compare-title">{t('Pilih tempat rekamanmu')}<br/>{t('diproses.')}</h2></div>
      <p>{t('Lihat perbedaan cara Catetin dan layanan cloud memproses rekamanmu.')}</p>
    </div>
    <div className="comparison-surface">
      <table className="comparison-matrix">
        <caption>{t('Gambaran umum pemrosesan lokal dan cloud.')}</caption>
        <thead><tr>
          <th scope="col" className="comparison-criterion">{t('Kriteria')}</th>
          <th scope="col" className="comparison-local">
            <span>{t('DI PERANGKATMU')}</span>
            <strong>Catetin</strong>
            <small>{t('Editor lokal saat ini')}</small>
            <figure className="comparison-scene comparison-image" aria-hidden="true">
              <img src="/illustrations/comparison-local.jpg" alt="" width="960" height="540" loading="lazy" decoding="async"/>
            </figure>
          </th>
          <th scope="col" className="comparison-cloud">
            <span>{t('DI SERVER PENYEDIA')}</span>
            <strong>{t('Layanan cloud')}</strong>
            <small>{t('Tergantung penyedia')}</small>
            <figure className="comparison-scene comparison-image" aria-hidden="true">
              <img src="/illustrations/comparison-cloud.jpg" alt="" width="960" height="540" loading="lazy" decoding="async"/>
            </figure>
          </th>
        </tr></thead>
        <tbody>{rows.map(([label, local, cloud]) => <tr key={label}>
          <th scope="row" className="comparison-criterion">{t(label)}</th>
          <td className="comparison-local" data-column={t('Catetin')} aria-label={`${t('Catetin')}: ${t(local)}`}>{t(local)}</td>
          <td className="comparison-cloud" data-column={t('Layanan cloud')} aria-label={`${t('Layanan cloud')}: ${t(cloud)}`}>{t(cloud)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="lp-fine">{t('Fitur dan kebijakan setiap layanan cloud dapat berbeda. Periksa ketentuan penyedia sebelum menggunakannya.')}</p>
  </section>;
}
