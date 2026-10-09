import { Fragment } from 'react';
import { cacheWritePriceLabel, modelPriceRows, pricingAssumptionLabels } from './pricing-details.js';

export function PricingMatches({ report, zh }) {
  const rows = modelPriceRows(report);
  const rate = (value) => value == null ? '—' : `$${value}/M`;
  return <section className="pricing-match">
    <header><div><b>{zh ? '模型定价匹配' : 'Model pricing matches'}</b><span>{zh ? '计价单位：美元 / 百万 Token · — 表示未计价，不是免费' : 'Estimate rates: USD per million tokens · — means unpriced, not free'}</span></div><span>{rows.length} {zh ? '条匹配' : 'matches'}</span></header>
    <div className="pricing-table-wrap"><table><thead><tr>
      <th>{zh ? '日志模型' : 'Log model'}</th><th>{zh ? '匹配 / 价格版本' : 'Match / price version'}</th><th>{zh ? '上下文 / 处理' : 'Context / tier'}</th><th>{zh ? '输入' : 'Input'}</th><th>{zh ? '缓存写' : 'Cache write'}</th><th>{zh ? '缓存读' : 'Cache read'}</th><th>{zh ? '输出' : 'Output'}</th>
    </tr></thead><tbody>{rows.map(({ key, model, bucket }) => {
      const note = bucket.priceNote?.[zh ? 'zh' : 'en'];
      const assumptions = pricingAssumptionLabels(bucket, zh);
      return <Fragment key={key}>
        <tr><td>{model}</td><td className={bucket.pricePattern ? 'priced' : ''}>{bucket.pricePattern || (zh ? '未匹配' : 'Unmatched')}{bucket.priceProvisional ? ` · ${zh ? '估算，见说明' : 'estimate, see note'}` : ''}<small className="pricing-version">{bucket.priceVersion}</small></td>
          <td>{bucket.pricePattern ? `${bucket.priceContextTier || 'default'} / ${bucket.priceProcessingTier || 'standard'}` : '—'}</td><td>{rate(bucket.priceInput)}</td><td>{cacheWritePriceLabel(bucket, zh)}</td><td>{rate(bucket.priceCacheRead)}</td><td>{rate(bucket.priceOutput)}</td></tr>
        {note || assumptions.length ? <tr className="pricing-detail-row"><td colSpan={7}><p>{note}</p>{assumptions.map((text) => <p key={text}>{text}</p>)}{bucket.priceSourceUrl?.startsWith('https://') ? <a href={bucket.priceSourceUrl} target="_blank" rel="noreferrer">{zh ? '查看价格来源' : 'View pricing source'}</a> : null}</td></tr> : null}
      </Fragment>;
    })}</tbody></table></div>
  </section>;
}
