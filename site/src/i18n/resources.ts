import type { Locale } from './index';
// Cornerstone "Resources" pages (en + zh). Facts checked against official sources in October 2026:
// EUR-Lex Directive (EU) 2019/882 (Art. 2, 3(23), 4(5)-(6), 14(4), 32), gesetze-im-internet.de BFSG (§§ 1, 2, 3, 38) and BFSGV,
// ETSI EN 301 549 V4.1.1 foreword, W3C WCAG 2.2, Deque automated coverage report. Not legal advice.
export const EAA_URL = 'https://eur-lex.europa.eu/eli/dir/2019/882/oj';
export const WAD_URL = 'https://eur-lex.europa.eu/eli/dir/2016/2102/oj';
export const BFSG_URL = 'https://www.gesetze-im-internet.de/bfsg/';
export const BFSGV_URL = 'https://www.gesetze-im-internet.de/bfsgv/';
export const DEQUE_URL = 'https://www.deque.com/automated-accessibility-testing-coverage/';
export const WCAG_URL = 'https://www.w3.org/TR/WCAG22/';
export const ETSI_URL = 'https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf';

export type ResourceKey = 'eaa' | 'bfsg' | 'microenterprise-exemption' | 'who-is-affected' | 'en-301-549-wcag';
export const resourceOrder: ResourceKey[] = ['eaa', 'bfsg', 'microenterprise-exemption', 'who-is-affected', 'en-301-549-wcag'];
export interface Resource { short: string; title: string; h1: string; description: string; lead: string; icon: string; html: (p: string) => string }

const en: Record<ResourceKey, Resource> = {
  eaa: {
    short: 'European Accessibility Act (EAA)', icon: 'scale',
    title: 'European Accessibility Act (EAA) explained',
    h1: 'The European Accessibility Act (EAA), explained',
    description: 'Plain-English guide to the European Accessibility Act, Directive (EU) 2019/882: what it covers, why 28 June 2025 matters, transition periods and how it differs from the Web Accessibility Directive.',
    lead: 'Directive (EU) 2019/882 sets common accessibility requirements for key consumer products and services in the EU. It has applied since 28 June 2025.',
    html: (p) => `
<h2>What is the EAA?</h2>
<p>The <strong>European Accessibility Act</strong> is <a href="${EAA_URL}">Directive (EU) 2019/882 of 17 April 2019 on the accessibility requirements for products and services</a>. As a directive, it is not applied directly: each Member State had to write it into national law. In Germany that law is the <a href="${p}/bfsg">Barrierefreiheitsstärkungsgesetz (BFSG)</a>.</p>
<h2>Key dates</h2>
<ul>
<li><strong>28 June 2025</strong> – the requirements apply to covered products placed on the market and to covered services provided to consumers after this date.</li>
<li><strong>Until 28 June 2030</strong> – a transitional period: service providers may keep using products they already lawfully used to provide similar services, and service contracts agreed before 28 June 2025 may continue unchanged until they expire, but for no longer than five years from that date.</li>
<li>Self-service terminals already in use may stay in use until the end of their economic life, for at most 20 years under the directive (Member States can set a shorter limit; Germany uses 15 years).</li>
</ul>
<h2>What does it cover?</h2>
<p>Products such as consumer computers and operating systems, payment terminals, ATMs, ticketing and check-in machines, smartphones, TV equipment for audiovisual media services and e-readers. Services such as electronic communications, access to audiovisual media services, elements of air, bus, rail and waterborne passenger transport, consumer banking, e-books and <strong>e-commerce</strong>. See <a href="${p}/who-is-affected">who is affected</a> for details.</p>
<p>For most websites, the relevant part is e-commerce and other services offered online to consumers: the site or app through which a consumer can conclude a contract needs to meet the accessibility requirements.</p>
<h2>Exemptions and limits</h2>
<ul>
<li><strong>Microenterprises providing services</strong> are exempt from the service requirements. Read the <a href="${p}/microenterprise-exemption">microenterprise exemption explainer</a>.</li>
<li>Economic operators may rely on a <em>disproportionate burden</em> or <em>fundamental alteration</em> exception, but they have to assess and document it (microenterprises dealing with products do not have to document the assessment).</li>
</ul>
<h2>EAA vs. Web Accessibility Directive</h2>
<p>Do not confuse the EAA with the <a href="${WAD_URL}">Web Accessibility Directive (EU) 2016/2102</a>. The Web Accessibility Directive covers the websites and mobile apps of <strong>public sector bodies</strong>. The EAA covers products and services that private economic operators offer <strong>to consumers</strong>. Both point to the same technical standard, <a href="${p}/en-301-549-wcag">EN 301 549 and WCAG</a>.</p>
<h2>What should a business do?</h2>
<ol>
<li>Check whether your products or services are in scope and whether an exemption applies.</li>
<li>Test your site against WCAG – automated checks first (try our <a href="${p}/free-scan">free scan</a>), then manual review, because automated testing finds only about 57% of issues (<a href="${DEQUE_URL}">Deque</a>).</li>
<li>Fix issues in your code. An <a href="${p}/blog/why-accessibility-overlays-dont-work">overlay widget does not make a site accessible</a>.</li>
<li>Publish information about how your service meets the requirements and keep a dated record of your work.</li>
</ol>`,
  },
  bfsg: {
    short: 'BFSG (Germany)', icon: 'doc',
    title: 'BFSG – Germany’s Barrierefreiheitsstärkungsgesetz explained',
    h1: 'The BFSG: Germany’s accessibility law, explained',
    description: 'What the Barrierefreiheitsstärkungsgesetz (BFSG) and its ordinance BFSGV mean for online shops and digital services in Germany: scope, dates, microenterprise exemption and transition rules.',
    lead: 'The Barrierefreiheitsstärkungsgesetz (BFSG) implements the European Accessibility Act in Germany. It has applied since 28 June 2025.',
    html: (p) => `
<h2>What is the BFSG?</h2>
<p>The <a href="${BFSG_URL}">Barrierefreiheitsstärkungsgesetz (BFSG)</a> is the German law implementing <a href="${p}/eaa">Directive (EU) 2019/882, the European Accessibility Act</a>. The detailed technical requirements are set out in an ordinance, the <a href="${BFSGV_URL}">Verordnung zum Barrierefreiheitsstärkungsgesetz (BFSGV)</a>.</p>
<h2>Scope (§ 1 BFSG)</h2>
<p>The BFSG applies to listed products placed on the market after 28 June 2025 and to listed services provided <strong>to consumers</strong> after 28 June 2025, including telecommunications services, elements of passenger transport services, consumer banking services, e-books and <strong>services in electronic commerce</strong> (“Dienstleistungen im elektronischen Geschäftsverkehr”).</p>
<p>The law defines e-commerce services as digital services offered through websites and mobile apps that are provided electronically at the individual request of a consumer with a view to concluding a consumer contract (§ 2 No. 26 BFSG). In practice: most online shops and online booking flows aimed at consumers.</p>
<h2>What is not covered</h2>
<p>§ 1(4) BFSG excludes certain website and app content, for example pre-recorded time-based media and office file formats published before 28 June 2025, online maps (if essential navigation information is provided accessibly), third-party content the business neither funds, develops nor controls, and archived content not updated after 28 June 2025. Offers aimed only at businesses (B2B) are not consumer services.</p>
<h2>Microenterprises</h2>
<p>§ 3(3) BFSG: the accessibility requirement does not apply to microenterprises that offer or provide services. A microenterprise (§ 2 No. 17) employs fewer than ten people and has either an annual turnover of no more than €2 million or an annual balance sheet total of no more than €2 million. See the <a href="${p}/microenterprise-exemption">microenterprise exemption explainer</a>.</p>
<h2>What the BFSGV asks of online services</h2>
<p>The BFSGV sets general requirements for services (§ 12), for example providing information about the service in an accessible way and making websites and apps perceivable, operable, understandable and robust, plus additional requirements for e-commerce (§ 19), such as accessible information about payment and identification methods. In practice, businesses use <a href="${p}/en-301-549-wcag">EN 301 549 and WCAG</a> as the technical benchmark.</p>
<h2>Transition rules (§ 38 BFSG)</h2>
<ul>
<li>Until 27 June 2030, service providers may keep providing services using products they already lawfully used before 28 June 2025.</li>
<li>Service contracts concluded before 28 June 2025 may continue unchanged until they end, but not beyond 27 June 2030.</li>
<li>Self-service terminals already in use may be used until the end of their economic life, but for no longer than 15 years after first use.</li>
</ul>
<h2>Enforcement</h2>
<p>Market surveillance is carried out by authorities designated under the law of the German federal states (Länder).</p>
<h2>Next steps</h2>
<p>Run a <a href="${p}/free-scan">free scan</a> of your checkout or booking flow, plan a manual review, and keep a dated record of what you tested and fixed. Remember: <a href="${p}/blog/what-automated-accessibility-testing-cant-catch">automated testing cannot catch everything</a>.</p>`,
  },
  'microenterprise-exemption': {
    short: 'Microenterprise exemption', icon: 'users',
    title: 'EAA & BFSG microenterprise exemption explained',
    h1: 'The microenterprise exemption, explained',
    description: 'Does the EAA or BFSG apply to small businesses? Fewer than 10 staff and turnover or balance sheet of no more than €2 million: exempt for services, not for products. What that means in practice.',
    lead: 'Microenterprises that provide services are exempt from the EAA’s service accessibility requirements. Microenterprises that deal with products are not.',
    html: (p) => `
<h2>Who counts as a microenterprise?</h2>
<p>Under Article 3(23) of the <a href="${EAA_URL}">European Accessibility Act</a> a microenterprise is an enterprise that:</p>
<ul>
<li>employs <strong>fewer than 10 persons</strong>, <em>and</em></li>
<li>has an <strong>annual turnover of no more than €2 million</strong> <em>or</em> an <strong>annual balance sheet total of no more than €2 million</strong>.</li>
</ul>
<p>Both conditions matter: staff count, and one of the two financial thresholds. The German <a href="${p}/bfsg">BFSG</a> uses the same definition (§ 2 No. 17 BFSG).</p>
<h2>Services: exempt</h2>
<p>Article 4(5) of the directive: microenterprises providing services are exempt from the service accessibility requirements and the related obligations. § 3(3) BFSG says the same for Germany. A small online shop with five employees and €800,000 turnover is therefore, as a rule, not legally required to meet the EAA service requirements for its shop.</p>
<h2>Products: not exempt</h2>
<p>The exemption does <strong>not</strong> cover products (for example e-readers, payment terminals or consumer computers). Microenterprises dealing with products still have to meet the product requirements; they are only relieved from documenting a disproportionate-burden assessment, but must provide the relevant information if a market surveillance authority asks.</p>
<h2>Things to check</h2>
<ul>
<li><strong>Growth.</strong> If you cross a threshold, the exemption may no longer apply. Keep an eye on staff numbers and annual figures.</li>
<li><strong>Groups and partners.</strong> How staff and turnover are counted when you belong to a group can be complex – ask an adviser.</li>
<li><strong>Agencies.</strong> If you are a small agency building shops for clients, the exemption depends on your <em>client</em>, who provides the service, not on you.</li>
<li><strong>Customers still benefit.</strong> Even if you are exempt, accessible sites reach more customers. A <a href="${p}/free-scan">free scan</a> is a low-effort start.</li>
</ul>
<p>Not sure if you are in scope at all? Read <a href="${p}/who-is-affected">who is affected by the EAA</a>.</p>`,
  },
  'who-is-affected': {
    short: 'Who is affected?', icon: 'globe',
    title: 'Who is affected by the European Accessibility Act?',
    h1: 'Who is affected by the EAA?',
    description: 'Which businesses, products and services fall under the European Accessibility Act and the BFSG: e-commerce, banking, transport, e-books, telecoms – and who is not in scope.',
    lead: 'The EAA applies to listed products and to listed services provided to consumers in the EU – including e-commerce. Here is how to tell whether that includes you.',
    html: (p) => `
<h2>Covered services</h2>
<p>Under Article 2(2) of the <a href="${EAA_URL}">EAA</a>, the following services provided to consumers after 28 June 2025 are covered:</p>
<ul>
<li>electronic communications services (except transmission services used for machine-to-machine communication);</li>
<li>services providing access to audiovisual media services;</li>
<li>elements of air, bus, rail and waterborne passenger transport services – websites, mobile services, electronic tickets and ticketing services, travel information and interactive self-service terminals;</li>
<li>consumer banking services;</li>
<li>e-books and dedicated software;</li>
<li><strong>e-commerce services</strong> – services provided at a distance, through websites and mobile apps, at the individual request of a consumer with a view to concluding a consumer contract.</li>
</ul>
<h2>Covered products</h2>
<p>Consumer general-purpose computer hardware and operating systems; payment terminals; ATMs, ticketing and check-in machines and interactive information terminals; consumer terminal equipment for electronic communications and for audiovisual media services; e-readers.</p>
<h2>Who is responsible?</h2>
<p>Manufacturers, authorised representatives, importers and distributors of products, and <strong>service providers</strong>. For a website, that usually means the business that offers the service to consumers – not the agency or platform that built it, although contracts often pass work on to them.</p>
<h2>Probably not in scope</h2>
<ul>
<li><strong>B2B-only offers</strong> – the service rules cover services provided to consumers.</li>
<li><strong>Microenterprises providing services</strong> – see the <a href="${p}/microenterprise-exemption">microenterprise exemption</a>.</li>
<li><strong>Purely informational websites</strong> that do not offer a covered service (for example a brochure site without online ordering) – but check carefully, since booking or contract forms may change this.</li>
<li><strong>Public sector bodies</strong> fall under a different law: the <a href="${WAD_URL}">Web Accessibility Directive (EU) 2016/2102</a>.</li>
</ul>
<h2>Outside the EU?</h2>
<p>The EAA applies to products and services on the EU market. A business based outside the EU that sells to consumers in the EU can therefore be affected too.</p>
<h2>Germany</h2>
<p>In Germany, the scope is set out in § 1 of the <a href="${p}/bfsg">BFSG</a>, which mirrors the directive.</p>
<p>In scope, or unsure? Start with a <a href="${p}/free-scan">free scan</a> and see our <a href="${p}/pricing">plans</a> for ongoing monitoring.</p>`,
  },
  'en-301-549-wcag': {
    short: 'EN 301 549 & WCAG 2.2', icon: 'check',
    title: 'EN 301 549 and WCAG 2.2 explained',
    h1: 'EN 301 549 and WCAG 2.2, explained',
    description: 'How the European standard EN 301 549 relates to WCAG 2.1 and WCAG 2.2, what changed in EN 301 549 V4.1.1, and what that means for EAA and BFSG work.',
    lead: 'EN 301 549 is the European accessibility standard for ICT. For web content it builds on the W3C’s Web Content Accessibility Guidelines (WCAG).',
    html: (p) => `
<h2>What is EN 301 549?</h2>
<p>EN 301 549, “Accessibility requirements for ICT products and services”, is a European standard produced by ETSI, CEN and CENELEC. Its web, document and software chapters (clauses 9, 10 and 11) are based on <a href="${WCAG_URL}">WCAG</a>.</p>
<h2>Which version applies?</h2>
<ul>
<li><strong>EN 301 549 V3.2.1 (2021)</strong> is the version cited in the Official Journal for the <a href="${WAD_URL}">Web Accessibility Directive</a> (public sector). For web content it incorporates <strong>WCAG 2.1 Level AA</strong>.</li>
<li><strong>EN 301 549 V4.1.1</strong> was adopted in August 2026 and published in September 2026. It aligns clauses 9–11 with <strong>WCAG 2.2</strong> and adds an annex mapping it to the <a href="${p}/eaa">European Accessibility Act</a>. <a href="${ETSI_URL}">According to ETSI</a>, it gives a presumption of conformity with the EAA only once it is cited in the Official Journal under that directive – which, as of October 2026, has not happened yet.</li>
</ul>
<h2>What is WCAG 2.2?</h2>
<p><a href="${WCAG_URL}">WCAG 2.2</a> is a W3C Recommendation (first published October 2023, current edition December 2024). It is organised under four principles – perceivable, operable, understandable and robust – with success criteria at levels A, AA and AAA. It is backwards compatible with WCAG 2.1, except that 4.1.1 Parsing was removed.</p>
<p>New at level A and AA in WCAG 2.2:</p>
<ul>
<li>2.4.11 Focus Not Obscured (Minimum) – AA</li>
<li>2.5.7 Dragging Movements – AA</li>
<li>2.5.8 Target Size (Minimum) – AA</li>
<li>3.2.6 Consistent Help – A</li>
<li>3.3.7 Redundant Entry – A</li>
<li>3.3.8 Accessible Authentication (Minimum) – AA</li>
</ul>
<h2>What should you aim for?</h2>
<p>Many teams target <strong>WCAG 2.2 Level AA</strong> today: it includes everything in WCAG 2.1 AA (except the removed Parsing criterion) and matches where EN 301 549 is heading. Allyfolio runs axe-core rules tagged for WCAG 2.0, 2.1 and 2.2 A/AA.</p>
<h2>Automated checks are only part of it</h2>
<p>Many success criteria – meaningful alt text, focus order, understandable content – need people to judge. Automated testing finds about 57% of issues by volume (<a href="${DEQUE_URL}">Deque</a>). Read <a href="${p}/blog/what-automated-accessibility-testing-cant-catch">what automated testing can’t catch</a>, then try a <a href="${p}/free-scan">free scan</a>.</p>`,
  },
};

const zh: Record<ResourceKey, Resource> = {
  eaa: {
    short: '《欧洲无障碍法案》（EAA）', icon: 'scale',
    title: '《欧洲无障碍法案》（EAA）详解',
    h1: '《欧洲无障碍法案》（EAA）详解',
    description: '通俗解读《欧洲无障碍法案》即指令 (EU) 2019/882：适用范围、2025 年 6 月 28 日的意义、过渡期，以及它与《网络无障碍指令》的区别。',
    lead: '指令 (EU) 2019/882 为欧盟境内的关键消费类产品和服务设定了统一的无障碍要求，自 2025 年 6 月 28 日起适用。',
    html: (p) => `
<h2>什么是 EAA？</h2>
<p><strong>《欧洲无障碍法案》</strong>即 <a href="${EAA_URL}">2019 年 4 月 17 日关于产品和服务无障碍要求的指令 (EU) 2019/882</a>。作为指令，它不直接适用，而需要由各成员国转化为本国法律。在德国，对应的法律是<a href="${p}/bfsg">《无障碍强化法》（BFSG）</a>。</p>
<h2>关键日期</h2>
<ul>
<li><strong>2025 年 6 月 28 日</strong>：此后投放市场的相关产品，以及此后向消费者提供的相关服务，须满足相关要求。</li>
<li><strong>至 2030 年 6 月 28 日</strong>：过渡期内，服务提供者可继续使用此前已合法用于提供类似服务的产品；2025 年 6 月 28 日前签订的服务合同可不经修改继续履行至到期，但自该日起最长不超过五年。</li>
<li>已投入使用的自助终端可继续使用至其经济寿命结束，指令规定最长 20 年（成员国可设定更短期限，德国为 15 年）。</li>
</ul>
<h2>涵盖哪些内容？</h2>
<p>产品包括：消费类计算机及操作系统、支付终端、自动取款机、售票机和值机设备、智能手机、用于视听媒体服务的电视设备以及电子阅读器。服务包括：电子通信、视听媒体服务接入、航空/巴士/铁路/水运客运服务的相关环节、面向消费者的银行服务、电子书以及<strong>电子商务</strong>。详见<a href="${p}/who-is-affected">哪些企业受影响</a>。</p>
<p>对大多数网站而言，关键在于电子商务及其他面向消费者的在线服务：消费者可借以订立合同的网站或应用需要满足无障碍要求。</p>
<h2>豁免与限制</h2>
<ul>
<li><strong>提供服务的微型企业</strong>可豁免服务类要求，详见<a href="${p}/microenterprise-exemption">微型企业豁免说明</a>。</li>
<li>经营者可援引“不成比例的负担”或“根本性改变”例外，但须进行评估并留档（经营产品的微型企业无需将评估留档）。</li>
</ul>
<h2>EAA 与《网络无障碍指令》的区别</h2>
<p>请勿将 EAA 与<a href="${WAD_URL}">《网络无障碍指令》(EU) 2016/2102</a> 混淆。后者针对<strong>公共部门机构</strong>的网站和移动应用；EAA 则针对私营经营者<strong>向消费者</strong>提供的产品和服务。两者都参考同一技术标准：<a href="${p}/en-301-549-wcag">EN 301 549 与 WCAG</a>。</p>
<h2>企业应该做什么？</h2>
<ol>
<li>确认您的产品或服务是否在适用范围内，以及是否适用豁免。</li>
<li>依据 WCAG 测试网站：先做自动化检测（可试试我们的<a href="${p}/free-scan">免费扫描</a>），再做人工审查，因为自动化测试只能发现约 57% 的问题（<a href="${DEQUE_URL}">Deque 研究</a>）。</li>
<li>在代码中修复问题。<a href="${p}/blog/why-accessibility-overlays-dont-work">覆盖层插件无法让网站真正无障碍</a>。</li>
<li>公布您的服务如何满足要求的相关信息，并保留带日期的工作记录。</li>
</ol>`,
  },
  bfsg: {
    short: 'BFSG（德国）', icon: 'doc',
    title: 'BFSG：德国《无障碍强化法》详解',
    h1: 'BFSG：德国无障碍法律详解',
    description: '德国《无障碍强化法》（BFSG）及其条例 BFSGV 对网店和数字服务意味着什么：适用范围、日期、微型企业豁免和过渡规则。',
    lead: '《无障碍强化法》（Barrierefreiheitsstärkungsgesetz，BFSG）是德国落实《欧洲无障碍法案》的法律，自 2025 年 6 月 28 日起适用。',
    html: (p) => `
<h2>什么是 BFSG？</h2>
<p><a href="${BFSG_URL}">《无障碍强化法》（BFSG）</a>是德国转化<a href="${p}/eaa">指令 (EU) 2019/882（《欧洲无障碍法案》）</a>的法律。具体技术要求规定在其配套条例 <a href="${BFSGV_URL}">《无障碍强化法条例》（BFSGV）</a>中。</p>
<h2>适用范围（BFSG 第 1 条）</h2>
<p>BFSG 适用于 2025 年 6 月 28 日之后投放市场的所列产品，以及 2025 年 6 月 28 日之后<strong>向消费者</strong>提供的所列服务，包括电信服务、客运服务的相关环节、面向消费者的银行服务、电子书以及<strong>电子商务服务</strong>（“Dienstleistungen im elektronischen Geschäftsverkehr”）。</p>
<p>法律将电子商务服务定义为：通过网站和移动应用提供、应消费者个别请求以电子方式提供、旨在订立消费者合同的数字服务（BFSG 第 2 条第 26 项）。实际上，大多数面向消费者的网店和在线预订流程都属于此类。</p>
<h2>不适用的内容</h2>
<p>BFSG 第 1 条第 4 款排除了部分网站和应用内容，例如 2025 年 6 月 28 日前发布的预录制时基媒体和办公文件格式、在线地图（前提是导航所需的关键信息以无障碍方式提供）、经营者既未资助、开发也不控制的第三方内容，以及 2025 年 6 月 28 日后不再更新的存档内容。仅面向企业（B2B）的服务不属于面向消费者的服务。</p>
<h2>微型企业</h2>
<p>BFSG 第 3 条第 3 款：无障碍要求不适用于提供服务的微型企业。微型企业（第 2 条第 17 项）指雇员少于 10 人，且年营业额不超过 200 万欧元或年度资产负债表总额不超过 200 万欧元的企业。详见<a href="${p}/microenterprise-exemption">微型企业豁免说明</a>。</p>
<h2>BFSGV 对在线服务的要求</h2>
<p>BFSGV 规定了服务的一般要求（第 12 条），例如以无障碍方式提供服务信息，使网站和应用可感知、可操作、可理解且稳健；并对电子商务提出附加要求（第 19 条），例如以无障碍方式提供支付和身份识别方式的信息。实践中，企业通常以 <a href="${p}/en-301-549-wcag">EN 301 549 和 WCAG</a> 作为技术基准。</p>
<h2>过渡规则（BFSG 第 38 条）</h2>
<ul>
<li>至 2030 年 6 月 27 日，服务提供者可继续使用 2025 年 6 月 28 日前已合法使用的产品提供服务。</li>
<li>2025 年 6 月 28 日前签订的服务合同可不经修改继续履行至期满，但不得超过 2030 年 6 月 27 日。</li>
<li>已投入使用的自助终端可继续使用至其经济寿命结束，但自首次使用起最长不超过 15 年。</li>
</ul>
<h2>执法</h2>
<p>市场监管由德国各联邦州依州法指定的主管机关负责。</p>
<h2>下一步</h2>
<p>对您的结账或预订流程进行一次<a href="${p}/free-scan">免费扫描</a>，规划人工审查，并保留带日期的测试与修复记录。请记住：<a href="${p}/blog/what-automated-accessibility-testing-cant-catch">自动化测试无法发现所有问题</a>。</p>`,
  },
  'microenterprise-exemption': {
    short: '微型企业豁免', icon: 'users',
    title: 'EAA 与 BFSG 的微型企业豁免详解',
    h1: '微型企业豁免详解',
    description: 'EAA 或 BFSG 是否适用于小企业？雇员少于 10 人且营业额或资产负债表总额不超过 200 万欧元：服务类豁免，产品类不豁免。实践中意味着什么。',
    lead: '提供服务的微型企业可豁免 EAA 的服务类无障碍要求；经营产品的微型企业则不在豁免之列。',
    html: (p) => `
<h2>什么是微型企业？</h2>
<p>根据<a href="${EAA_URL}">《欧洲无障碍法案》</a>第 3 条第 23 项，微型企业是指同时满足以下条件的企业：</p>
<ul>
<li>雇员<strong>少于 10 人</strong>，<em>并且</em></li>
<li><strong>年营业额不超过 200 万欧元</strong>，<em>或</em><strong>年度资产负债表总额不超过 200 万欧元</strong>。</li>
</ul>
<p>两项条件都很重要：雇员人数，以及两项财务门槛之一。德国 <a href="${p}/bfsg">BFSG</a> 采用相同定义（BFSG 第 2 条第 17 项）。</p>
<h2>服务：豁免</h2>
<p>指令第 4 条第 5 款规定，提供服务的微型企业可豁免服务类无障碍要求及相关义务；BFSG 第 3 条第 3 款在德国作了相同规定。因此，一家有 5 名员工、年营业额 80 万欧元的小网店，原则上在法律上无需就其网店满足 EAA 的服务要求。</p>
<h2>产品：不豁免</h2>
<p>该豁免<strong>不</strong>适用于产品（例如电子阅读器、支付终端或消费类计算机）。经营产品的微型企业仍须满足产品要求；它们只是无需将“不成比例负担”评估留档，但在市场监管机关要求时须提供相关信息。</p>
<h2>需要注意的事项</h2>
<ul>
<li><strong>企业成长。</strong>一旦超过门槛，豁免可能不再适用。请关注员工人数和年度数据。</li>
<li><strong>集团与关联企业。</strong>若您隶属于某个集团，员工和营业额的计算方式可能较复杂，请咨询顾问。</li>
<li><strong>代理商。</strong>如果您是为客户搭建网店的小型代理商，是否豁免取决于提供服务的<em>客户</em>，而不是您。</li>
<li><strong>顾客依然受益。</strong>即使获得豁免，无障碍网站也能触达更多顾客。<a href="${p}/free-scan">免费扫描</a>是一个省力的起点。</li>
</ul>
<p>不确定自己是否在适用范围内？请阅读<a href="${p}/who-is-affected">哪些企业受 EAA 影响</a>。</p>`,
  },
  'who-is-affected': {
    short: '哪些企业受影响？', icon: 'globe',
    title: '哪些企业受《欧洲无障碍法案》影响？',
    h1: '哪些企业受 EAA 影响？',
    description: '哪些企业、产品和服务属于《欧洲无障碍法案》和 BFSG 的适用范围：电子商务、银行、交通、电子书、电信，以及哪些不在范围内。',
    lead: 'EAA 适用于所列产品，以及在欧盟向消费者提供的所列服务（包括电子商务）。以下帮助您判断自己是否在其中。',
    html: (p) => `
<h2>涵盖的服务</h2>
<p>根据 <a href="${EAA_URL}">EAA</a> 第 2 条第 2 款，2025 年 6 月 28 日之后向消费者提供的以下服务在适用范围内：</p>
<ul>
<li>电子通信服务（用于机器对机器通信的传输服务除外）；</li>
<li>提供视听媒体服务接入的服务；</li>
<li>航空、巴士、铁路和水运客运服务的相关环节：网站、移动服务、电子票和电子票务服务、出行信息以及交互式自助终端；</li>
<li>面向消费者的银行服务；</li>
<li>电子书及专用软件；</li>
<li><strong>电子商务服务</strong>：应消费者个别请求、通过网站和移动应用远程提供、旨在订立消费者合同的服务。</li>
</ul>
<h2>涵盖的产品</h2>
<p>消费类通用计算机硬件及操作系统；支付终端；自动取款机、售票机、值机设备和交互式信息终端；用于电子通信和视听媒体服务的消费类终端设备；电子阅读器。</p>
<h2>谁负有责任？</h2>
<p>产品的制造商、授权代表、进口商和分销商，以及<strong>服务提供者</strong>。对网站而言，通常是向消费者提供服务的企业，而不是搭建网站的代理商或平台，尽管合同常会把相关工作转交给它们。</p>
<h2>通常不在范围内</h2>
<ul>
<li><strong>仅面向企业（B2B）的服务</strong>：服务规则针对向消费者提供的服务。</li>
<li><strong>提供服务的微型企业</strong>：见<a href="${p}/microenterprise-exemption">微型企业豁免</a>。</li>
<li><strong>纯信息展示类网站</strong>，即不提供相关服务的网站（例如没有在线下单功能的宣传网站）。但请仔细核实，预订或合同表单可能改变这一判断。</li>
<li><strong>公共部门机构</strong>适用另一部法律：<a href="${WAD_URL}">《网络无障碍指令》(EU) 2016/2102</a>。</li>
</ul>
<h2>位于欧盟以外？</h2>
<p>EAA 适用于欧盟市场上的产品和服务。因此，位于欧盟以外但向欧盟消费者销售的企业也可能受到影响。</p>
<h2>德国</h2>
<p>在德国，适用范围由 <a href="${p}/bfsg">BFSG</a> 第 1 条规定，与指令保持一致。</p>
<p>在适用范围内，或尚不确定？先做一次<a href="${p}/free-scan">免费扫描</a>，并查看我们的持续监测<a href="${p}/pricing">方案</a>。</p>`,
  },
  'en-301-549-wcag': {
    short: 'EN 301 549 与 WCAG 2.2', icon: 'check',
    title: 'EN 301 549 与 WCAG 2.2 详解',
    h1: 'EN 301 549 与 WCAG 2.2 详解',
    description: '欧洲标准 EN 301 549 与 WCAG 2.1、WCAG 2.2 的关系，EN 301 549 V4.1.1 有哪些变化，以及这对 EAA 和 BFSG 相关工作意味着什么。',
    lead: 'EN 301 549 是欧洲的信息通信技术无障碍标准。对于网页内容，它以 W3C 的《网页内容无障碍指南》（WCAG）为基础。',
    html: (p) => `
<h2>什么是 EN 301 549？</h2>
<p>EN 301 549《ICT 产品和服务的无障碍要求》是由 ETSI、CEN 和 CENELEC 制定的欧洲标准。其中网页、文档和软件章节（第 9、10、11 条）以 <a href="${WCAG_URL}">WCAG</a> 为基础。</p>
<h2>适用哪个版本？</h2>
<ul>
<li><strong>EN 301 549 V3.2.1（2021）</strong>是在《欧盟官方公报》中针对<a href="${WAD_URL}">《网络无障碍指令》</a>（公共部门）引用的版本。对网页内容，它纳入了 <strong>WCAG 2.1 AA 级</strong>。</li>
<li><strong>EN 301 549 V4.1.1</strong> 于 2026 年 8 月通过、2026 年 9 月发布，将第 9–11 条与 <strong>WCAG 2.2</strong> 对齐，并新增一个与<a href="${p}/eaa">《欧洲无障碍法案》</a>对应的附录。<a href="${ETSI_URL}">根据 ETSI 的说明</a>，只有在该指令项下于《欧盟官方公报》中引用后，它才产生与 EAA 相符的推定效力；截至 2026 年 10 月，尚未引用。</li>
</ul>
<h2>什么是 WCAG 2.2？</h2>
<p><a href="${WCAG_URL}">WCAG 2.2</a> 是 W3C 推荐标准（2023 年 10 月首次发布，现行版本为 2024 年 12 月版）。它围绕四项原则（可感知、可操作、可理解、稳健）组织，成功标准分为 A、AA、AAA 三级。它向后兼容 WCAG 2.1，但删除了 4.1.1 解析（Parsing）。</p>
<p>WCAG 2.2 新增的 A 级和 AA 级标准：</p>
<ul>
<li>2.4.11 焦点不被遮挡（最低）– AA</li>
<li>2.5.7 拖动操作 – AA</li>
<li>2.5.8 目标尺寸（最低）– AA</li>
<li>3.2.6 一致的帮助 – A</li>
<li>3.3.7 冗余输入 – A</li>
<li>3.3.8 无障碍身份验证（最低）– AA</li>
</ul>
<h2>应以什么为目标？</h2>
<p>许多团队如今以 <strong>WCAG 2.2 AA 级</strong>为目标：它包含 WCAG 2.1 AA 的全部内容（已删除的解析标准除外），也与 EN 301 549 的发展方向一致。Allyfolio 运行标记为 WCAG 2.0、2.1 和 2.2 A/AA 的 axe-core 规则。</p>
<h2>自动化检测只是其中一部分</h2>
<p>许多成功标准，例如有意义的替代文本、焦点顺序和易懂的内容，都需要人来判断。按问题数量计，自动化测试约能发现 57% 的问题（<a href="${DEQUE_URL}">Deque 研究</a>）。请阅读<a href="${p}/blog/what-automated-accessibility-testing-cant-catch">自动化测试发现不了什么</a>，然后试试<a href="${p}/free-scan">免费扫描</a>。</p>`,
  },
};

export const resources: Record<Locale, Record<ResourceKey, Resource>> = { en, 'zh-CN': zh };

export const resourceUi = {
  en: {
    eyebrow: 'Resources', related: 'Related resources', disclaimerLabel: 'Not legal advice:',
    disclaimer: 'This page is general information to help you get oriented, checked against the official texts in October 2026. It is not legal advice. Check your own situation with a legal adviser.',
    sources: 'Official sources', ctaH: 'See where your site stands', ctaP: 'Run a free automated scan of one page, or compare plans for scheduled monitoring and a timestamped evidence trail.', ctaScan: 'Run a free scan', ctaPricing: 'See pricing',
    hubTitle: 'Resources: EAA, BFSG and WCAG guides', hubH1: 'Accessibility law and standards, in plain language',
    hubDescription: 'Plain-language guides to the European Accessibility Act, the German BFSG, the microenterprise exemption, who is affected, EN 301 549 and WCAG 2.2.',
    hubLead: 'Guides to the European Accessibility Act, Germany’s BFSG and the standards behind them. General information, not legal advice.',
    guides: 'Guides', articles: 'Articles', read: 'Read the guide',
  },
  'zh-CN': {
    eyebrow: '资源', related: '相关资源', disclaimerLabel: '不构成法律建议：',
    disclaimer: '本页为帮助您了解概况的一般信息，已于 2026 年 10 月对照官方文本核对。本页不构成法律建议，请就您的具体情况咨询法律顾问。',
    sources: '官方来源', ctaH: '了解您网站的现状', ctaP: '对单个页面进行免费的自动化扫描，或比较各方案，获得定期监测和带时间戳的证据记录。', ctaScan: '免费扫描', ctaPricing: '查看价格',
    hubTitle: '资源：EAA、BFSG 与 WCAG 指南', hubH1: '用通俗语言讲清无障碍法规与标准',
    hubDescription: '通俗解读《欧洲无障碍法案》、德国 BFSG、微型企业豁免、受影响的企业、EN 301 549 和 WCAG 2.2。',
    hubLead: '关于《欧洲无障碍法案》、德国 BFSG 及其背后标准的指南。仅为一般信息，不构成法律建议。',
    guides: '指南', articles: '文章', read: '阅读指南',
  },
} as const;

export const resourceSources = (k: ResourceKey): [string, string][] => {
  const s: Record<ResourceKey, [string, string][]> = {
    eaa: [['Directive (EU) 2019/882 (EUR-Lex)', EAA_URL], ['Directive (EU) 2016/2102 (EUR-Lex)', WAD_URL], ['BFSG (gesetze-im-internet.de)', BFSG_URL]],
    bfsg: [['BFSG (gesetze-im-internet.de)', BFSG_URL], ['BFSGV (gesetze-im-internet.de)', BFSGV_URL], ['Directive (EU) 2019/882 (EUR-Lex)', EAA_URL]],
    'microenterprise-exemption': [['Directive (EU) 2019/882 (EUR-Lex)', EAA_URL], ['BFSG (gesetze-im-internet.de)', BFSG_URL]],
    'who-is-affected': [['Directive (EU) 2019/882 (EUR-Lex)', EAA_URL], ['BFSG (gesetze-im-internet.de)', BFSG_URL], ['Directive (EU) 2016/2102 (EUR-Lex)', WAD_URL]],
    'en-301-549-wcag': [['ETSI EN 301 549 V4.1.1 (PDF)', ETSI_URL], ['WCAG 2.2 (W3C)', WCAG_URL], ['Deque: automated testing coverage', DEQUE_URL]],
  };
  return s[k];
};
