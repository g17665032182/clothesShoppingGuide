import {
  SHOPPING_RULES_NOTICE,
  SHOPPING_RULES_VERSION,
  type ShoppingRulesSourceDocumentId,
  type ShoppingRulesSuccess,
  type ShoppingRulesTopic,
} from '../dto/shopping-rules.dto.js';

type ShoppingRuleEntry = Readonly<{
  title: string;
  statements: readonly string[];
  sourceDocumentIds: readonly ShoppingRulesSourceDocumentId[];
}>;

// 目录只发布已确认契约中的当前系统事实，规则变化时须同步来源与版本。
const shoppingRulesCatalog = {
  shipping: {
    title: '运费规则',
    statements: [
      '当前本站订单使用 CNY，运费为 0.00，应付金额等于商品金额。',
      '该规则仅说明当前本站订单实现，不代表其他商家或未来订单的运费承诺。',
    ],
    sourceDocumentIds: ['order-crud-contract'],
  },
  payment: {
    title: '付款规则',
    statements: [
      '当前订单仅支持模拟支付，不产生真实扣款。',
      '支付期自订单创建起 30 分钟，具体截止时间以该订单的服务端记录为准。',
      '付款须由用户在原订单界面明确操作，模型不能代为支付。',
    ],
    sourceDocumentIds: [
      'order-crud-contract',
      'security-and-business-boundaries',
    ],
  },
  cancellation: {
    title: '取消规则',
    statements: [
      '仅支持取消本人尚未过期且处于 pending_payment 状态的待付款订单。',
      '用户须在原界面选择订单并明确确认，服务端在提交时重新校验取消资格。',
      '已付款订单取消尚未接入；模型查询规则或订单状态不构成取消授权。',
    ],
    sourceDocumentIds: [
      'order-crud-contract',
      'security-and-business-boundaries',
    ],
  },
  fulfillment: {
    title: '履约规则',
    statements: [
      '本站由管理员登记整单发货，用户在订单界面自行确认收货。',
      '履约查询仅返回本站本地订单状态、发货及完成时间，没有承运商实时轨迹。',
      '本站已登记发货不代表已揽件，订单已完成不代表承运商签收，不能据此推断派送位置或预计送达时间。',
      '模型不能代替用户确认收货。',
    ],
    sourceDocumentIds: [
      'order-crud-contract',
      'chat-tool-order-fulfillment-crud-contract',
      'security-and-business-boundaries',
    ],
  },
  after_sales: {
    title: '售后能力范围',
    statements: [
      '当前系统尚未接入真实退款、退货、换货或退款进度查询。',
      '当前没有经确认的真实店铺退换条件、费用、售后地址或处理期限来源。',
      '功能尚未接入不表示用户没有相关权利，也不能据此判断商家不退不换或用户不符合售后条件。',
      '助手不能声称已提交售后申请、已办理退款或已安排退换货。',
    ],
    sourceDocumentIds: [
      'order-crud-contract',
      'security-and-business-boundaries',
    ],
  },
} as const satisfies Readonly<Record<ShoppingRulesTopic, ShoppingRuleEntry>>;

export function readShoppingRules(
  topic: ShoppingRulesTopic,
): ShoppingRulesSuccess {
  const entry = shoppingRulesCatalog[topic];
  // 返回副本，调用方不能通过修改数组污染之后的规则查询。
  return {
    ok: true,
    scope: 'site_capabilities',
    source: 'approved_project_contracts',
    version: SHOPPING_RULES_VERSION,
    topic,
    title: entry.title,
    statements: [...entry.statements],
    sourceDocumentIds: [...entry.sourceDocumentIds],
    notice: SHOPPING_RULES_NOTICE,
  };
}
