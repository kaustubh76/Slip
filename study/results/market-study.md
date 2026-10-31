# Market study

Real Channel3 offers, sampled on 2026-10-19. 8 searches, 240 distinct products, 8 credits.

Every number below is recomputed from `study/snapshots/` by `pnpm study:report`, with no key and no network. Offers are mapped by the production adapter and compared by `@slip/check`'s own rule — in stock, condition new, a positive USD price, one entry per listing — so nothing here counts an offer Slip could not have compared.

## The three numbers

| | |
|---|---|
| Products with 2+ comparable offers | **18.33%** (44 of 240) |
| Typical gap, cheapest to priciest | **17.02%** · $12.31 |
| Middle half of those gaps | 0% to 50.03% |
| Dearer offer pays more commission | **47.5%** (19 of 40 where rates differ) |

Every product in the sample had at least one comparable offer.

That share is of the 40 products where two offers stated **different** commission rates, not of the 240 sampled or the 44 with two or more comparable offers. The other 4 could not show a conflict at all — fewer than two of their offers stated a rate, or every rate was the same — so they are left out of the denominator rather than counted as agreement.

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

## Markets of one seller (G6)

Comparable products whose offers all belong to one seller: **1 of 44**. The check used to compare those offers with each other — the count cleared R2, and the cheapest of one seller's own listings became the market it was measured against. `R2B_SINGLE_SELLER_MARKET` holds them instead.

The collapse joins two domains when one is a subdomain of the other, and otherwise only when they are the same domain. Nothing here rests on a guess about who owns what (docs/MERCHANTS.md §4.2).

| Product | Comparable offers | Stores |
|---|---|---|
| Ribbed Merino Wool Socks | 2 | cos.com |

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

## If you are about to use Slip on real prices

Two products in three carry a single comparable offer, so a checkout picked at random is held for too few offers rather than paid or rejected — correct, and a poor way to see what Slip does. Density is uneven and the table above is the map: search where the comparisons are. These are products from the 2026-10-19 sample that had two or more comparable offers and a real spread between them, with the suspected grouping errors below left out, so each one is a comparison Slip can stand behind. A catalogue moves — the queries are the durable part, the ids are not.

| Search for | Product | Gap | Offers |
|---|---|---|---|
| wireless noise cancelling headphones | The Collexion Wireless Noise Cancelling Headphones | 11.34% · $66.01 | 9 |
| wireless noise cancelling headphones | AONIC 50 GEN 2 Wireless Noise Cancelling Headphones | 12.33% · $42.70 | 6 |
| office desk chair | Taytum Faux Leather Upholstered Mid-Back Executive Office Chair | 89.47% · $118.05 | 5 |
| office desk chair | Circa 3581 Office Chair | 17.65% · $164.93 | 4 |
| office desk chair | Ergonomic Leather Office Chair with Rocking Function | 53.1% · $45.13 | 4 |
| cast iron skillet | Cast Iron Skillet | 62.78% · $25.05 | 4 |
| yoga mat | Yoga Mat | 76.51% · $13.00 | 4 |
| cast iron skillet | Lodge Chef Collection Cast Iron Skillet | 17.02% · $5.09 | 4 |
| office desk chair | Lyncott Home Office Desk Chair | 29.28% · $35.11 | 3 |
| trail running shoes | Nike Acg Pegasus Trail Men's Trail Running Shoes | 16.2% · $21.62 | 3 |
| stainless steel water bottle | GEOJUG Stainless Steel Vacuum-Insulated Water Bottle | 41.1% · $12.31 | 3 |
| stainless steel water bottle | Owala 24 oz. FreeSip Stainless Steel Water Bottle | 16.67% · $5.00 | 3 |

## Has a real listing ever tried this?

Slip rejects a purchase when a listing reads like instructions to the agent, so it is worth saying whether this sample contains any. All 240 products carried a description — 175,685 characters of store prose in all, a median of 712 each — and every one of them was read for the four things the steering check looks for that a pattern can pick out of prose:

- text that addresses an AI, assistant, agent or model directly
- text that refers to the reader's instructions, rules or system prompt
- text that instructs the reader which offer to select, or to stop comparing prices
- text that claims an authority a listing cannot have

**1 of 240 matched**, and the model was asked about each one.

| Pattern | Product | What it said | Judged |
|---|---|---|---|
| `approved-supplier` | Asics GEL Venture 11 Mens Trail Running Shoes | …Trail Running Shoes online - rebel is Australia’s preferred retailer of biggest sports brands at best prices. Nike, ad… | ordinary selling (`claude-opus-5-5`, `steer-2`) |

Each candidate was put to the production classifier — the same model, the same prompt, the same text an agent would have been shown — and the verdict is recorded so this table needs no key to print. A pattern cannot tell a merchant boasting that it is a "preferred retailer" from a listing claiming the buyer pre-approved it, which is the whole reason the check asks a model. This is that distinction, on real data.

**What this cannot say.** It reports what matched a stated list of patterns, and text written to avoid those words would pass it — which is the whole reason the production check asks a model instead. So read it as a statement about forms, not about intent. Two of the classifier's six categories are missing from it as well: copy imitating a system message, a tool call or JSON, and copy asking for something other than selling the product, neither of which has a form a pattern can pick out of ordinary prose.

**So, of Slip's two reasons to stop a purchase, one is measured here and one is not.** The commission conflict is in this sample: the offer paying the most is the dearer one in 19 of 40 products where both could be read. A listing steering an agent is not, which is why SlipBench has to plant its own and label it synthetic. Slip's steering rule guards against something this sample does not contain — worth saying plainly, since agents doing the buying is new and the listings were written for people.

**And the size of it.** 216 of 240 descriptions are longer than the 400 characters an agent is handed, which is why there is a bound at all: uncapped, a ten-product search would spend several thousand characters of an agent's context on store prose, every byte of it untrusted and sized by whoever wrote the listing.

## Grouping, for a person to check (G4)

Channel3 groups each merchant's offer under one product id, and Slip compares only within one id. Whether that grouping is right cannot be measured from the data itself, so here are 30 products with two or more comparable offers to look at by hand. G4 passes at one wrong grouping or fewer.

The product id is printed so a verdict has somewhere to land: a checker can name the id rather than the title, and two of the titles here are the same words. Nothing else in the repository records which grouping is right, which is why G4 is still open and why the gate that depends on it cannot be counted ([RAILS.md](../../docs/RAILS.md) §14, G12).

The products the gap heuristic already suspects come first, so the list cannot leave out the cases most worth a person's time — two of the three fell outside the first thirty in sample order. They are the ones the check holds rather than pays, so a verdict on them settles what R2a is doing, not whether a purchase was wrong.

| Product id | Product | Gap | Stores |
|---|---|---|---|
| `YGRXk8Z` | Lodge Blacklock '63 Cast-iron Skillet | 1492.89% · $597.01 | basspro.com, atbbq.com, lodgecastiron.com, cabelas.com |
| `lRPLrNw` | Premium Yoga Mat | 101% · $19.09 | bestbuy.com, lowes.com |
| `USvisFV` | Power Systems 68" x 24" Premium Yoga Mat, 1/8" Thick Non Slip Lightweight Sticky Exercise Mat | 376.13% · $71.09 | lowes.com, kohls.com, homedepot.com |
| `IgMpes8` | Cast Iron Skillet | 75.62% · $15.05 | lodgecastiron.com, surlatable.com |
| `a8bvjjd` | Lodge Cast Iron Skillet | 27.92% · $13.96 | jcpenney.com, slt-sfcc-react-production.mobify-storefront.com |
| `B7XotZl` | Lodge Chef Collection Cast Iron Skillet | 17.02% · $5.09 | lodgecastiron.com, bestbuy.com, dillards.com, worldmarket.com |
| `XVgmAC7` | Lodge Seasoned Skillet | 0% · $0.00 | surlatable.com, williams-sonoma.com |
| `0K3Ri7y` | Cast Iron Skillet | 62.78% · $25.05 | lodgecastiron.com, cabelas.com, basspro.com, crateandbarrel.com |
| `SV31FoZ` | Keychron P6 Ultra 8k Wireless Custom Mechanical Keyboard | 0% · $0.00 | bestbuy.com, keychron.com |
| `bSPSF3y` | Logitech K845 Mechanical Illuminated Keyboard | 42.86% · $30.00 | logitech.com, newegg.com |
| `fkBA6Sh` | Merino Wool Midweight Hunting Boot Socks | 31.89% · $7.01 | cabelas.com, basspro.com |
| `QXkv3Xy` | Wide Open Merino Wool Vintage Stripe Cushioned Crew Socks | 31.66% · $6.01 | cabelas.com, basspro.com |
| `gNJX86Y` | Ribbed Merino Wool Socks | 0% · $0.00 | cos.com, cos.com |
| `w3RKdTx` | Garvee Comfortable Office Desk Chair | 17.93% · $22.96 | walmart.com, garvee.ca |
| `5vzpb9w` | HOMCOM Leather Home Office Desk Chair | 1.75% · $2.00 | aosom.com, bestbuy.com |
| `Ft0Bfbl` | Executive Office Desk Chair | 13.89% · $14.17 | walmart.com, lowes.com |
| `fy2VzgO` | Lyncott Home Office Desk Chair | 29.28% · $35.11 | 1stopbedrooms.com, afastores.com, furniturepick.com |
| `l8XeZv8` | Ergonomic Leather Office Chair with Rocking Function | 53.1% · $45.13 | giantex.com, bestbuy.com, kohls.com, homedepot.com |
| `QgVNPKc` | Taytum Faux Leather Upholstered Mid-Back Executive Office Chair | 89.47% · $118.05 | homedepot.com, walmart.com, bestbuy.com, staples.com, officedepot.com |
| `NTqGuio` | Tova Desk Chair | 0.1% · $1.00 | luluandgeorgia.com, highfashionhome.com, shoppeamberlewis.com |
| `awGi5Qs` | Circa 3581 Office Chair | 17.65% · $164.93 | skybygramophone.com, lumens.com, luxedecor.com, crutchfield.com |
| `S3nfI6e` | Great Wave Stainless Steel Water Bottle | 24.5% · $4.90 | kohls.com, hottopic.com |
| `etcDx0c` | GEOJUG Stainless Steel Vacuum-Insulated Water Bottle | 41.1% · $12.31 | academy.com, belk.com, bestbuy.com |
| `K077vJL` | Wide Loop Cap | 0% · $0.00 | kleankanteen.com, bestbuy.com |
| `dzojWma` | Owala 24 oz. FreeSip Stainless Steel Water Bottle | 16.67% · $5.00 | publiclands.com, golfgalaxy.com, dickssportinggoods.com |
| `il6goj7` | Nova 4 Trail Running Shoes | 0% · $0.00 | cabelas.com, basspro.com, dickssportinggoods.com |
| `zr4B9BV` | Nike Acg Pegasus Trail Men's Trail Running Shoes | 16.2% · $21.62 | kickscrew.com, academy.com, nike.com |
| `t1SLQyj` | Experience Wild 3+ Trail Running Shoes | 0% · $0.00 | dickssportinggoods.com, publiclands.com |
| `u5cSkdm` | Men's GEL-TRABUCO 13 Trail Running Shoes | 0% · $0.00 | dickssportinggoods.com, publiclands.com |
| `zgfwZKe` | Kestrel Trail running shoes | 0% · $0.00 | backcountry.com, steepandcheap.com |

