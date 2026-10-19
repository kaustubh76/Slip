# Market study

Real Channel3 offers, sampled on 2026-10-19. 8 searches, 240 distinct products, 8 credits.

Every number below is recomputed from `study/snapshots/` by `pnpm study:report`, with no key and no network. Offers are mapped by the production adapter and compared by `@slip/check`'s own rule — in stock, condition new, a positive USD price, one entry per listing — so nothing here counts an offer Slip could not have compared.

## The three numbers

| | |
|---|---|
| Products with 2+ comparable offers | **18.33%** (44 of 240) |
| Typical gap, cheapest to priciest | **17.02%** · $12.31 |
| Middle half of those gaps | 0% to 50.03% |
| Dearer offer pays more commission | **47.5%** (19 of 40 comparable) |

Every product in the sample had at least one comparable offer.

A quarter of the comparable products are priced identically at every store (0% gap), so the median is doing real work here: where there is a difference it is usually large.

**G1** asks for 60% of sampled products to carry two or more comparable offers. This sample: 18.33% — **fail**.

A fail is not a defect in the check; it says this sample's categories are mostly single-retailer. The spec's answer is to narrow the categories, and to lead with SlipBench rather than this number.

## Suspected grouping errors, and what they would cost

3 of the 44 comparable products show a gap above 100%. Those are far more likely to be Channel3 filing two different items under one product id than a store selling the same thing for a fraction of the price — one of them puts a $40 skillet beside a $637 one. They are listed below as suspected, not counted as bargains.

Excluding them, the typical gap is **16.67%** rather than 17.02%. Quote the smaller number.

**This is a live risk in the product, not just in the study.** Slip compares within one product id, so a wrong grouping makes the cheapest "comparable" offer a different item — and a correct purchase of the dearer one would be rejected against it. The spec anticipated this as gate G4 and left it [UNVERIFIED]; this sample is the first evidence that it happens, at roughly one comparable product in fifteen.

| Suspected gap | Cheapest → priciest | Product | Stores |
|---|---|---|---|
| 1492.89% | $39.99 → $637.00 | Lodge Blacklock '63 Cast-iron Skillet | basspro.com, atbbq.com, lodgecastiron.com, cabelas.com |
| 376.13% | $18.90 → $89.99 | Power Systems 68" x 24" Premium Yoga Mat, 1/8" Thick Non Slip Lightweight Sticky Exercise Mat | lowes.com, kohls.com, homedepot.com |
| 101% | $18.90 → $37.99 | Premium Yoga Mat | bestbuy.com, lowes.com |

## Why so few comparisons

Channel3 listed 321 offers across the 240 products. The adapter read 321 of them and the check could compare 318, so **neither Slip's mapping nor its comparison rule is what thins the sample** — the catalogue simply carries one offer for most products.

| Offers not compared | |
|---|---|
| No price Slip could read | 0 |
| Not priced in USD | 0 |
| Not in stock | 0 |
| Not condition new | 3 |
| The same listing twice | 0 |

| Comparable offers | Products |
|---|---|
| 1 | 196 |
| 2 | 27 |
| 3 | 8 |
| 4 | 6 |
| 5 | 1 |
| 6 | 1 |
| 9 | 1 |

## What was searched, and how dense each one was

| Query | Products | 2+ comparable offers |
|---|---|---|
| cast iron skillet | 30 | 6 (20%) |
| mechanical keyboard | 30 | 2 (6.67%) |
| mens merino wool socks | 30 | 3 (10%) |
| office desk chair | 30 | 8 (26.67%) |
| stainless steel water bottle | 30 | 4 (13.33%) |
| trail running shoes | 30 | 10 (33.33%) |
| wireless noise cancelling headphones | 30 | 5 (16.67%) |
| yoga mat | 30 | 6 (20%) |

## Grouping, for a person to check (G4)

Channel3 groups each merchant's offer under one product id, and Slip compares only within one id. Whether that grouping is right cannot be measured from the data itself, so here are 30 products with two or more comparable offers to look at by hand. G4 passes at one wrong grouping or fewer.

| Product | Gap | Stores |
|---|---|---|
| Cast Iron Skillet | 75.62% · $15.05 | lodgecastiron.com, surlatable.com |
| Lodge Blacklock '63 Cast-iron Skillet | 1492.89% · $597.01 | basspro.com, atbbq.com, lodgecastiron.com, cabelas.com |
| Lodge Cast Iron Skillet | 27.92% · $13.96 | jcpenney.com, slt-sfcc-react-production.mobify-storefront.com |
| Lodge Chef Collection Cast Iron Skillet | 17.02% · $5.09 | lodgecastiron.com, bestbuy.com, dillards.com, worldmarket.com |
| Lodge Seasoned Skillet | 0% · $0.00 | surlatable.com, williams-sonoma.com |
| Cast Iron Skillet | 62.78% · $25.05 | lodgecastiron.com, cabelas.com, basspro.com, crateandbarrel.com |
| Keychron P6 Ultra 8k Wireless Custom Mechanical Keyboard | 0% · $0.00 | bestbuy.com, keychron.com |
| Logitech K845 Mechanical Illuminated Keyboard | 42.86% · $30.00 | logitech.com, newegg.com |
| Merino Wool Midweight Hunting Boot Socks | 31.89% · $7.01 | cabelas.com, basspro.com |
| Wide Open Merino Wool Vintage Stripe Cushioned Crew Socks | 31.66% · $6.01 | cabelas.com, basspro.com |
| Ribbed Merino Wool Socks | 0% · $0.00 | cos.com, cos.com |
| Garvee Comfortable Office Desk Chair | 17.93% · $22.96 | walmart.com, garvee.ca |
| HOMCOM Leather Home Office Desk Chair | 1.75% · $2.00 | aosom.com, bestbuy.com |
| Executive Office Desk Chair | 13.89% · $14.17 | walmart.com, lowes.com |
| Lyncott Home Office Desk Chair | 29.28% · $35.11 | 1stopbedrooms.com, afastores.com, furniturepick.com |
| Ergonomic Leather Office Chair with Rocking Function | 53.1% · $45.13 | giantex.com, bestbuy.com, kohls.com, homedepot.com |
| Taytum Faux Leather Upholstered Mid-Back Executive Office Chair | 89.47% · $118.05 | homedepot.com, walmart.com, bestbuy.com, staples.com, officedepot.com |
| Tova Desk Chair | 0.1% · $1.00 | luluandgeorgia.com, highfashionhome.com, shoppeamberlewis.com |
| Circa 3581 Office Chair | 17.65% · $164.93 | skybygramophone.com, lumens.com, luxedecor.com, crutchfield.com |
| Great Wave Stainless Steel Water Bottle | 24.5% · $4.90 | kohls.com, hottopic.com |
| GEOJUG Stainless Steel Vacuum-Insulated Water Bottle | 41.1% · $12.31 | academy.com, belk.com, bestbuy.com |
| Wide Loop Cap | 0% · $0.00 | kleankanteen.com, bestbuy.com |
| Owala 24 oz. FreeSip Stainless Steel Water Bottle | 16.67% · $5.00 | publiclands.com, golfgalaxy.com, dickssportinggoods.com |
| Nova 4 Trail Running Shoes | 0% · $0.00 | cabelas.com, basspro.com, dickssportinggoods.com |
| Nike Acg Pegasus Trail Men's Trail Running Shoes | 16.2% · $21.62 | kickscrew.com, academy.com, nike.com |
| Experience Wild 3+ Trail Running Shoes | 0% · $0.00 | dickssportinggoods.com, publiclands.com |
| Men's GEL-TRABUCO 13 Trail Running Shoes | 0% · $0.00 | dickssportinggoods.com, publiclands.com |
| Kestrel Trail running shoes | 0% · $0.00 | backcountry.com, steepandcheap.com |
| Trinity FKT Trail Running Shoes | 17.82% · $18.00 | dickssportinggoods.com, publiclands.com |
| Norda 001 Trail Running Shoes | 50.19% · $128.00 | article-london.com, garmentory.com |

