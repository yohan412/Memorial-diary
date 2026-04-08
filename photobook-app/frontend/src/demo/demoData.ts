// BookSetupPage는 bookSpecUid가 photobook/squarebook로 시작하는 것만 옵션에 노출한다.
export const DEMO_BOOK_SPEC_UID = 'photobook-demo'
export const DEMO_BOOK_UID_PREFIX = 'demo-book-'

export const DEMO_BOOK_SPECS = [
  {
    uid: DEMO_BOOK_SPEC_UID,
    bookSpecUid: DEMO_BOOK_SPEC_UID,
    name: 'DEMO 포토북 (A5 비슷한 판형)',
    innerTrimWidthMm: 148,
    innerTrimHeightMm: 210,
    pageMin: 24,
    pageMax: 120,
    pageIncrement: 2,
    coverType: 'soft',
    bindingType: 'perfect',
  },
]

export const DEMO_TEMPLATES = {
  cover: [
    {
      templateUid: 'demo-cover-1',
      uid: 'demo-cover-1',
      name: 'DEMO 표지 템플릿',
      templateKind: 'cover',
      url: '/demo/bw/bw3.png',
    },
  ],
  content: [
    {
      templateUid: 'demo-content-1',
      uid: 'demo-content-1',
      name: 'DEMO 내지 템플릿',
      templateKind: 'content',
      url: '/demo/bw/bw1.png',
    },
  ],
}

export const DEMO_TEMPLATE_DETAIL: Record<string, unknown> = {
  'demo-cover-1': {
    success: true,
    data: {
      templateUid: 'demo-cover-1',
      name: 'DEMO 표지 템플릿',
      parameters: {
        definitions: [
          {
            key: 'title',
            label: '제목',
            binding: 'text',
            required: true,
          },
          {
            key: 'date',
            label: '날짜',
            binding: 'text',
            required: false,
          },
          {
            key: 'photo',
            label: '표지 사진',
            binding: 'file',
            required: false,
          },
        ],
      },
    },
  },
  'demo-content-1': {
    success: true,
    data: {
      templateUid: 'demo-content-1',
      name: 'DEMO 내지 템플릿',
      parameters: {
        definitions: [
          {
            key: 'title',
            label: '제목',
            binding: 'text',
            required: false,
          },
          {
            key: 'date',
            label: '날짜',
            binding: 'text',
            required: false,
          },
          {
            key: 'photo',
            label: '사진',
            binding: 'file',
            required: false,
          },
        ],
      },
    },
  },
}

export const DEMO_PHOTO_FILES = [
  { fileName: 'demo-bw1.png', previewUrl: '/demo/bw/bw1.png' },
  { fileName: 'demo-bw2.png', previewUrl: '/demo/bw/bw2.png' },
  { fileName: 'demo-bw3.png', previewUrl: '/demo/bw/bw3.png' },
  { fileName: 'demo-bw4.png', previewUrl: '/demo/bw/bw4.png' },
]

export const DEMO_ORDERS = [
  {
    orderUid: 'demo-order-001',
    orderStatus: 20,
    orderStatusDisplay: '결제 완료',
    updatedAt: '2026-04-06T10:15:00Z',
    items: [{ bookUid: 'demo-book-1', bookTitle: 'TEST 추억 앨범', quantity: 1 }],
  },
]

export const DEMO_ORDER_DETAIL: Record<string, unknown> = {
  'demo-order-001': {
    orderUid: 'demo-order-001',
    orderStatus: 20,
    orderStatusDisplay: '결제 완료',
    createdAt: '2026-04-06T10:14:30Z',
    updatedAt: '2026-04-06T10:15:00Z',
    paidCreditAmount: 19900,
    totalAmount: 19900,
    shippingFee: 0,
    items: [{ bookUid: 'demo-book-1', bookTitle: 'TEST 추억 앨범', quantity: 1 }],
    shipping: {
      recipientName: '홍길동',
      recipientPhone: '010-1234-5678',
      postalCode: '06100',
      address1: '서울특별시 강남구 테헤란로 123',
      address2: '101동 1001호',
      memo: '문 앞에 두세요',
    },
  },
}

export const DEMO_ESTIMATE = {
  success: true,
  data: {
    paidCreditAmount: 19900,
    totalAmount: 19900,
    shippingFee: 0,
    vatAmount: 0,
    lines: [
      {
        bookUid: 'demo-book-1',
        bookTitle: 'TEST 추억 앨범',
        quantity: 1,
        unitPrice: 19900,
        lineTotal: 19900,
      },
    ],
  },
}

