const ENTITY_TYPE = {
  DELIVERYFEE: 'DELIVERYFEE',
  PRODUCT: 'PRODUCT',
}
const COUPONTEMPLATE_STATUS = {
  valid: 'valid',
}
const ORDER_SUBTYPE = {
  takeout: 'takeout',
}

const EXCLUDED_MODE = {
  ORDER: 'ORDER',
  PRODUCT: 'PRODUCT',
}

const ENTITY_TYPES = ['PRICE', 'PRODUCT', 'ORDER', 'PLATFORM']

const VALUE_TYPE = {
  FULLGIFT: 'FULLGIFT',
  FUllEXEMPTION: 'FUllEXEMPTION',
  PRICEDEDUCTION: 'PRICEDEDUCTION',
  FULLDEDUCTION: 'FULLDEDUCTION',
  FULLDISCOUNT: 'FULLDISCOUNT',
}
const BASE_CONDITION_TYPE = {
  qty: 'qty',
  amount: 'amount',
}

const LIMIT_TYPE = {
  MIN: 'MIN',
  EVERY: 'EVERY',
}

const RECOMMEND_MODE = {
  //推荐模式  推荐模式下需要分别加入剩余的优惠来计算  只要有任何一个不满足就失败
  NORMAL: 'normal',
  RECOMMEND: 'recommend',
}

const DISCOUNT_MODE = {
  //处理模式 在手动模式下 所有的计算都按顺序来计算  自动模式下按遍历最大优惠计算
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
}

let excludedMode = EXCLUDED_MODE.PRODUCT

/******************************************************** mainLogic ****************************************************************/
/**
 * 计算推荐的优惠并返回被推荐的券或活动
 * @param cart 商品集合 包含商品详情与已选择的配料详情
 * @param storeCouponDetails 该门店下面所有的优惠信息集合
 * @param subType 订单子类型 区别运费计算  自提或者外卖
 * @param userCouponList 用户拥有的优惠券集合
 * @param templateSortedList 用户选择的优惠集合
 * @param deliveryFee 运费
 * @param excludedMode 互斥模式 使用整单互斥还是下放到商品层面
 * @param discountMode 用户处理模式 分为自动与手动，手动需要根据templateSortedList计算  自动忽略templateSortedList 默认自动
 * @param deliveryFeeForce 强制推荐运费券 即使用户有couponChooseList
 * @returns {*}
 */
export default function discountCalculate(payload) {
  // console.log('dicountCalculate payload is ', payload)
  //计算出基础的优惠结果
  let result = innerDiscountCalculate(payload)
  // console.log('no more recommed result is ', result)
  // console.log('calculate time with ', new Date().getTime() - date.getTime(), 'mm')
  let recommendMode
  if (payload.discountMode !== DISCOUNT_MODE.MANUAL) {
    //手动模式下 就需要展示推荐 其他模式能选的都全选上
    return result
  } else {
    recommendMode = RECOMMEND_MODE.RECOMMEND //需要传递RecommendMode 主要是想减少处理逻辑，拿一串顺序的优惠进去，只要有一个不满足就可以throw了
  }

  //这里recommend只有初始计算所产生的活动与优惠券信息
  //当需要推荐信息的展示，分别拿可以使用但未被选中的活动与优惠券去计算

  let templateSortedListRes = result.templateSortedList
  let activityChoose = {}
  let couponChoose = {}
  templateSortedListRes.forEach(function (item) {
    if (item.isPromo) {
      activityChoose[item.templateId] = true
    } else {
      couponChoose[item.couponId] = true
    }
  })

  let activityUnChooseRes = []
  result.activitys.forEach(function (item) {
    if (!activityChoose[item.templateId]) {
      activityUnChooseRes.push(item)
    }
  })

  let couponUnChooseRes = [],
    couponChooseIds = []
  result.coupons.forEach(function (item) {
    if (!couponChoose[item.couponId]) {
      couponUnChooseRes.push(item)
    } else {
      couponChooseIds.push(item.couponId)
    }
  })
  activityUnChooseRes.forEach(function (temp) {
    let data = innerDiscountCalculate({
      recommendMode,
      ...payload,
      templateSortedList: templateSortedListRes.concat(temp),
    })
    data.templateSortedList.some(function (item) {
      if (item.isPromo && item.templateId === temp.templateId) {
        result.recommend.activityIds.push(temp.templateId)
        return true
      }
    })
  })

  couponUnChooseRes.forEach(function (temp) {
    let data = innerDiscountCalculate({
      recommendMode,
      ...payload,
      templateSortedList: templateSortedListRes.concat(temp),
    })
    let couponChooseById = {}
    data.templateSortedList.forEach(function (item) {
      if (!item.isPromo) {
        couponChooseById[item.couponId] = true
      }
    })
    if (couponChooseById[temp.couponId]) {
      //券不一样的地方 同时 其他的券也要被选上 因为同样的模板的券在推荐的时候与基础计算顺序不一样。可能导致推荐的先被选中，已选中的滞后了导致未选中
      let isChoose = true
      couponChooseIds.forEach(function (id) {
        if (!couponChooseById[id]) {
          isChoose = false
        }
      })
      if (isChoose) {
        result.recommend.couponIds.push(temp.couponId)
      }
    }
  })
  // console.log('more recommend result is ', result)
  // console.log('calculate time with ', new Date().getTime() - date.getTime(), 'mm')
  return result
}

function innerDiscountCalculate(payload) {
  let {
    cart,
    subType,
    storeCouponDetails,
    deliveryFee = 0,
    userCouponList = [],
    deliveryFeeForce = false,
    date = new Date(),
    recommendMode = RECOMMEND_MODE.NORMAL,
    discountMode = DISCOUNT_MODE.AUTOMATIC,
  } = payload
  if (payload.excludedMode) {
    excludedMode = payload.excludedMode
  }
  let productInfoById = {},
    productIds = []
  let productInfoByCouponTemplate = {} //通过模板找对应的商品

  let coupons = [] //全量
  let activitys = [] //全量

  let couponChooseList, activityChooseList
  let templateSortedIndex = {} //为后面每个层次做排序用  排序是为了在用手接入模式下  不去找优惠最大的，就按顺序计算即可
  if (payload.templateSortedList && discountMode === DISCOUNT_MODE.MANUAL) {
    couponChooseList = [] 
    activityChooseList = []
    payload.templateSortedList.forEach(function (item, index) {
      if (item.isPromo) {
        activityChooseList.push(item.templateId)
      } else {
        couponChooseList.push(item.couponId)
      }
      templateSortedIndex[item.templateId] = index
    })
  }

  let templateSortedList = []

  /***************      用户拥有的优惠券数据结构组装        **************/
  let couponsByTemplate = {} //用户拥有的优惠券分配到各个模板中的数据结构
  let deliveryCouponsByTemplate = {} //运费券存储

  userCouponList.forEach(function (item) {
    let template = item.template
    if (!template.typeInfo) {
      return
    }
    coupons.push({
      templateId: template.objectId,
      isPromo: false,
      couponId: item.objectId,
    })
    if (template.typeInfo.entityType === ENTITY_TYPE.DELIVERYFEE) {
      if (deliveryCouponsByTemplate[template.objectId]) {
        deliveryCouponsByTemplate[template.objectId].push(item)
      } else {
        deliveryCouponsByTemplate[template.objectId] = [item]
      }
      return
    }
    if (couponChooseList && couponChooseList.indexOf(item.objectId) === -1) {
      return
    }
    if (couponsByTemplate[item.template.objectId]) {
      couponsByTemplate[item.template.objectId].push(item)
    } else {
      couponsByTemplate[item.template.objectId] = [item]
    }
  })
  /*******************************************************************/
  let recommend = {
    // 给用户推荐活动与优惠券选择的数据结构
    couponIds: [],
    activityIds: [],
  }

  //构造已每个优惠层次找活动的数据结构
  let couponTemplateByEntityType = {}
  let couponTemplateByEntityTypeById = {}
  ENTITY_TYPES.forEach(function (str) {
    couponTemplateByEntityType[str] = []
    couponTemplateByEntityTypeById[str] = {}
  })
  //构建产品信息相关数据结构
  cart.items &&
    cart.items.map(function (productInfo) {
      let { product, qty, inventory, features = [] } = productInfo
      let total = product.price.sale * qty
      let extraFee = inventory ? inventory.extraFee : 0
      let ingredientsAmount = 0
      features.forEach(function (feature) {
        let ingredientsList = feature.ingredientsList || []
        ingredientsList.forEach(function (ingredient) {
          ingredientsAmount += ingredient.price * ingredient.qty * feature.qty
        })
      })
      productIds.push(product.objectId)
      productInfoById[product.objectId] = {
        storeId: cart.storeId,
        qty: qty,
        exemptionQty: 0,
        product,
        features,
        inventory,
        ingredientsAmount,
        saleAmount: total + ingredientsAmount,
        itemAmount: total + ingredientsAmount,
        discountAmount: 0,
        promoAmount: 0,
        couponAmount: 0,
        coupons: [],
        extraFee: extraFee * qty,
      }
    })
  //构建优惠计算相关数据结构
  let couponTemplateById = {}
  storeCouponDetails &&
    storeCouponDetails.forEach(function (storeCoupon) {
      let { couponTemplate, allProductApply, productBlackList = [], productList = [] } = storeCoupon
      couponTemplateById[couponTemplate.objectId] = couponTemplate
      let blackIds = productBlackList.map(p => p.objectId)
      let { usageRule } = couponTemplate
      if (
        !usageRule ||
        (usageRule.endAt && date > new Date(usageRule.endAt)) ||
        couponTemplate.status !== COUPONTEMPLATE_STATUS.valid
      ) {
        return
      }
      productInfoByCouponTemplate[couponTemplate.objectId] = []
      if (allProductApply) {
        productIds.forEach(function (id) {
          if (blackIds.indexOf(id) === -1) {
            productInfoByCouponTemplate[couponTemplate.objectId].push(productInfoById[id])
          }
        })
      } else {
        productList.forEach(function (p) {
          if (productIds.indexOf(p.objectId) !== -1) {
            productInfoByCouponTemplate[couponTemplate.objectId].push(productInfoById[p.objectId])
          }
        })
      }
      if (productInfoByCouponTemplate[couponTemplate.objectId].length === 0) {
        return
      }

      if (couponTemplate.typeInfo.isPromo) {
        activitys.push({
          templateId: couponTemplate.objectId,
          isPromo: true,
        })
        //如果是活动  那么需要判定是否在用户所有用的券选择范围中才去计算
        if (activityChooseList && activityChooseList.indexOf(couponTemplate.objectId) === -1) {
          return
        }
      } else {
        //如果是优惠券  那么需要判定是否在用户所有用的券的范围中并且在选择中才去计算
        if (!couponsByTemplate[couponTemplate.objectId]) {
          return
        }
      }
      if (
        couponTemplate.typeInfo.entityType &&
        !couponTemplateByEntityTypeById[couponTemplate.typeInfo.entityType][couponTemplate.objectId]
      ) {
        couponTemplateByEntityType[couponTemplate.typeInfo.entityType].push(couponTemplate)
        couponTemplateByEntityTypeById[couponTemplate.typeInfo.entityType][couponTemplate.objectId] = true
      }
    })

  let params = baseCalculate({
    recommendMode, // 推荐模式
    discountMode, // 计算模式 （手动， 自动）
    templateSortedList, // 用户已使用的优惠模板
    templateSortedIndex, // 用户已使用的优惠模板的排序
    couponsByTemplate, // 模板id对应的优惠券
    couponTemplateById, // id对应的优惠模板
    couponTemplateByEntityType, // 优惠类型（product， order， price， plathform）所对应的使用的优惠
    productInfoByCouponTemplate, // 每个当前可使用的优惠所对应的适用的产品
  })

  let data = finalCalculate({
    couponChooseList,
    templateSortedList,
    couponTemplateById,
    cart,
    productInfoById,
    subType,
    deliveryCouponsByTemplate,
    deliveryFee,
    deliveryFeeForce,
    giftObject: params.giftObject,
  })
  return {
    data,
    coupons,
    activitys,
    recommend,
    templateSortedList,
  }
}

/**
 * @param couponTemplateById
 * @param couponTemplateByEntityType
 * @param productInfoByCouponTemplate
 * @param couponsByTemplate 用户所拥有的的优惠券
 * @returns {{PRICE:{}, PRODUCT: {}, PLATFORM: {}, ORDER: {}}}
 */
function baseCalculate(payload) {
  let {
    recommendMode, // 推荐模式
    discountMode, // 计算模式 （手动， 自动）
    templateSortedList, // 用户已使用的优惠模板
    templateSortedIndex, // 用户已使用的优惠模板的排序
    couponsByTemplate, // 模板id对应的优惠券
    couponTemplateById, // id对应的优惠模板
    couponTemplateByEntityType, // 优惠类型（product， order， price， plathform）所对应的使用的优惠
    productInfoByCouponTemplate, // 每个当前可使用的优惠所对应的适用的产品
  } = payload
  let giftObject = {}
  ENTITY_TYPES.forEach(function (str) {
    giftObject[str] = {}
  })

  let couponTemplateUsedByProduct = {}
  let usedTemplateIds = []
  try {
    ENTITY_TYPES.forEach(entityType => {
      let fullGiftCouponTemplates = [],
        otherCouponTempaltes = []
      couponTemplateByEntityType[entityType].forEach(couponTemplate => {
        let typeInfo = couponTemplate.typeInfo
        if (typeInfo.valueType === VALUE_TYPE.FULLGIFT) {
          fullGiftCouponTemplates.push(couponTemplate)
        } else {
          otherCouponTempaltes.push(couponTemplate)
        }
      })

      if (discountMode === DISCOUNT_MODE.MANUAL) {
        //手动模式下排序
        otherCouponTempaltes.sort(function (item1, item2) {
          return templateSortedIndex[item1.objectId] < templateSortedIndex[item2.objectId] ? -1 : 1
        })
        fullGiftCouponTemplates.sort(function (item1, item2) {
          return templateSortedIndex[item1.objectId] < templateSortedIndex[item2.objectId] ? -1 : 1
        })
      }
      // console.log('otherCouponTempaltes is ', otherCouponTempaltes)
      doDiscountChoose({
        giftObject,
        discountMode,
        recommendMode,
        usedTemplateIds,
        couponTemplateById,
        couponsByTemplate,
        templateSortedList,
        otherCouponTempaltes,
        fullGiftCouponTemplates,
        productInfoByCouponTemplate,
        couponTemplateUsedByProduct,
      })
    })
  } catch (e) {
    console.log('discountCalculate error message is ', e.message)
    //当推荐模式时 可以通过抛错退出循环
  }

  return { giftObject }
}

/**
 * 计算每一层的活动与优惠
 * @param {*} payload
 */
function doDiscountChoose(payload) {
  let {
    giftObject,
    discountMode,
    recommendMode,
    usedTemplateIds,
    couponTemplateById,
    couponsByTemplate, //用户所拥有优惠券
    templateSortedList,
    otherCouponTempaltes,
    fullGiftCouponTemplates,
    productInfoByCouponTemplate,
    couponTemplateUsedByProduct,
  } = payload
  let unUsedCouponTemplate = [].concat(otherCouponTempaltes)
  let maxIndex = 0,
    maxValue = 0,
    globalTotalPrice = 0,
    maxProductInfos = [],
    maxGift,
    globalDiscountByProductId,
    globalExemptionQtyByProductId,
    globalProductInfoLength = 0,
    maxCouponId

  let func = (couponTemplate, discount, couponId) => {
    if (discount > 0) {
      //构建商品所使用的优惠对照
      maxProductInfos.forEach(function (productInfo) {
        if (couponTemplateUsedByProduct[productInfo.product.objectId]) {
          couponTemplateUsedByProduct[productInfo.product.objectId].push(couponTemplate.objectId)
        } else {
          couponTemplateUsedByProduct[productInfo.product.objectId] = [couponTemplate.objectId]
        }
      })
      templateSortedList.push({
        couponId,
        isPromo: couponTemplate.typeInfo.isPromo,
        templateId: couponTemplate.objectId,
      })
      usedTemplateIds.push(couponTemplate.objectId)
    }
    unUsedCouponTemplate.splice(maxIndex, 1)
    ;(maxIndex = 0), (maxValue = 0), (maxProductInfos = [])
    ;(maxCouponId = undefined), (globalTotalPrice = 0), (globalProductInfoLength = 0)
    if (unUsedCouponTemplate.length === 0) {
      return true
    }
    return false
  }
  while (true) {
    unUsedCouponTemplate.forEach((template, index) => {
      if (discountMode === DISCOUNT_MODE.MANUAL && index > 0) {
        //推荐模式下 按顺序选择 不按最大优惠最先
        return
      }
      let productInfos = productInfoByCouponTemplate[template.objectId]
      productInfos = findTemplateValidProduct({
        template,
        productInfos,
        usedTemplateIds,
        couponTemplateById,
        couponTemplateUsedByProduct,
      })
      if (productInfos.length === 0 && recommendMode === RECOMMEND_MODE.RECOMMEND) {
        throw new Error('recommend recommendMode break')
      }
      let { totalPrice, discount, discountByProductId, couponId, exemptionQtyByProductId } = getProductDiscount({
        productInfos,
        couponTemplate: template,
        coupons: couponsByTemplate[template.objectId],
      })
      // 当单商品的情况下 需要获取到真正享受优惠的商品
      if (template.typeInfo.entityType === ENTITY_TYPE.PRODUCT) {
        let productExists = {}
        Object.keys(discountByProductId).forEach(function (key) {
          productExists[key] = true
        })
        productInfos = productInfos.filter(function (p) {
          return productExists[p.product.objectId]
        })
      }

      if (discount === 0 && recommendMode === RECOMMEND_MODE.RECOMMEND) {
        throw new Error('recommend recommendMode break')
      }
      if (discount > maxValue || (discount === maxValue && productInfos.length < globalProductInfoLength)) {
        globalTotalPrice = totalPrice
        globalProductInfoLength = productInfos.length
        maxValue = discount
        maxIndex = index
        maxCouponId = couponId
        maxProductInfos = productInfos
        globalDiscountByProductId = discountByProductId //当为单商品时 需要分配到每个商品优惠金额
        globalExemptionQtyByProductId = exemptionQtyByProductId
      }
    })
    if (maxValue > 0) {
      updateProductInfo({
        exemptionQtyByProductId: globalExemptionQtyByProductId,
        discountByProductId: globalDiscountByProductId,
        discountTotal: maxValue,
        productInfos: maxProductInfos,
        percent: maxValue / globalTotalPrice,
        couponTemplate: unUsedCouponTemplate[maxIndex],
      })
    }
    let couponTemplate = unUsedCouponTemplate[maxIndex]
    if (func(couponTemplate, maxValue, maxCouponId)) {
      break
    }
  }
  unUsedCouponTemplate = [].concat(fullGiftCouponTemplates)
  while (true) {
    unUsedCouponTemplate.forEach((template, index) => {
      if (discountMode === DISCOUNT_MODE.MANUAL && index > 0) {
        //推荐模式下 按顺序选择 不按最大优惠最先
        return
      }
      let productInfos = productInfoByCouponTemplate[template.objectId]
      productInfos = findTemplateValidProduct({
        template,
        productInfos,
        usedTemplateIds,
        couponTemplateById,
        couponTemplateUsedByProduct,
      })
      if (productInfos.length === 0 && recommendMode === RECOMMEND_MODE.RECOMMEND) {
        throw new Error('recommend recommendMode break')
      }
      let { gift, totalPrice, discount, couponId, discountByProductId } = getProductDiscount({
        productInfos,
        couponTemplate: template,
        coupons: couponsByTemplate[template.objectId],
      })

      // 当单商品的情况下 需要获取到真正享受优惠的商品
      if (template.typeInfo.entityType === ENTITY_TYPE.PRODUCT) {
        let productExists = {}
        Object.keys(discountByProductId).forEach(function (key) {
          productExists[key] = true
        })
        productInfos = productInfos.filter(function (p) {
          return productExists[p.product.objectId]
        })
      }
      if (discount === 0 && recommendMode === RECOMMEND_MODE.RECOMMEND) {
        throw new Error('recommend recommendMode break')
      }
      if (discount > maxValue || (discount === maxValue && productInfos.length < globalProductInfoLength)) {
        maxValue = discount
        maxIndex = index
        maxCouponId = couponId
        globalProductInfoLength = productInfos.length
        globalTotalPrice = totalPrice
        maxGift = gift
        maxProductInfos = productInfos
      }
    })
    let couponTemplate = unUsedCouponTemplate[maxIndex]
    if (maxValue > 0) {
      if (giftObject[couponTemplate.typeInfo.entityType][maxGift.product.objectId]) {
        giftObject[couponTemplate.typeInfo.entityType][maxGift.product.objectId].qty =
          giftObject[couponTemplate.typeInfo.entityType][maxGift.product.objectId].qty + maxGift.qty
      } else {
        giftObject[couponTemplate.typeInfo.entityType][maxGift.product.objectId] = maxGift
      }
    }
    if (func(couponTemplate, maxValue, maxCouponId)) {
      break
    }
  }
}

/**
 * 通过优惠券或活动来计算出其被优惠的价格，以便于判断最优惠
 * 当couponTemplate为优惠券类型时候，coupon则有值
 * @param {*} payload
 */
function getProductDiscount(payload) {
  let { couponTemplate, productInfos } = payload
  if (couponTemplate.typeInfo.entityType !== ENTITY_TYPE.PRODUCT) {
    return innerGetProductDiscount(payload)
  } else {
    //针对单商品需要单独计算
    let totalPrice = 0,
      totalQty = 0,
      discount = 0,
      discountByProductId = {},
      gift,
      couponId,
      exemptionQtyByProductId = {}
    productInfos.forEach(function (item) {
      let result = innerGetProductDiscount({ ...payload, productInfos: [item] })
      if (!couponTemplate.typeInfo.isPromo) {
        //如果是优惠券 那就选择优惠最大的一个商品
        if (result.discount > discount) {
          discount = result.discount
          discountByProductId = {
            [item.product.objectId]: result.discount,
          }
          totalPrice = result.totalPrice
          totalQty = result.totalQty
          gift = result.gift
          exemptionQtyByProductId = {
            [item.product.objectId]: result.exemptionQty,
          }
          couponId = result.couponId
        }
      } else {
        totalPrice += result.totalPrice
        totalQty += result.totalQty
        discount += result.discount
        if (result.gift) {
          if (gift) {
            gift.qty += result.gift.qty
          } else {
            gift = result.gift
          }
        }
        discountByProductId[item.product.objectId] = result.discount
        exemptionQtyByProductId[item.product.objectId] = result.exemptionQty
      }
    })
    return { gift, discount, couponId, totalQty, totalPrice, discountByProductId, exemptionQtyByProductId }
  }
}

/**
 * innerGetProductDiscount细节
 * @param {*} payload
 */
function innerGetProductDiscount(payload) {
  let { productInfos, couponTemplate, coupons } = payload
  let { usageRule, typeInfo } = couponTemplate,
    discount = 0
  if (productInfos.length === 0) {
    return { discount }
  }
  let value = 0,
    selectedQty = 0,
    selectedPrice = 0 //不包含配料价格
  let selectedPriceIncludeIngredients = 0 //包含配料价格
  productInfos.forEach(function (item) {
    selectedQty = selectedQty + item.qty
    selectedPrice = selectedPrice + item.itemAmount - item.ingredientsAmount
    selectedPriceIncludeIngredients = selectedPriceIncludeIngredients + item.itemAmount
  })

  if (usageRule.valueType === BASE_CONDITION_TYPE.qty) {
    value = selectedQty
  } else {
    value = selectedPrice
  }
  let { finalValue, couponId } = getDiscountValue({
    value,
    coupons,
    valueRules: usageRule.valueRules,
    isCoupon: !couponTemplate.typeInfo.isPromo,
  })
  let gift = undefined
  let exemptionQty = 0 //记录一个满免的数量
  switch (typeInfo.valueType) {
    case VALUE_TYPE.FULLDEDUCTION: {
      //满减
      if (finalValue > selectedPriceIncludeIngredients) {
        discount = selectedPriceIncludeIngredients
      } else {
        discount = finalValue
      }
      break
    }
    case VALUE_TYPE.FULLDISCOUNT: {
      //满折
      discount = Math.round((selectedPrice * finalValue) / 10)
      break
    }
    case VALUE_TYPE.PRICEDEDUCTION: {
      //针对价格打折
      discount = Math.round((selectedPrice * finalValue) / 10)
      break
    }
    case VALUE_TYPE.FUllEXEMPTION: {
      //满免
      let qty =
        productInfos[0].qty - productInfos[0].exemptionQty > 1 ? productInfos[0].qty - productInfos[0].exemptionQty : 1
      //找出价格最低的予以免除

      let min = productInfos[0].itemAmount - productInfos[0].ingredientsAmount
      productInfos.forEach(function (product) {
        let amount = product.itemAmount - product.ingredientsAmount
        if (min == 0) {
          min = amount
        } else {
          if (amount > 0) {
            min = min > amount ? amount : min
          }
        }
      })
      discount = Math.round(finalValue * (min / qty))
      exemptionQty = finalValue
      break
    }
    case VALUE_TYPE.FULLGIFT: {
      //满赠
      discount = couponTemplate.giftProduct.price.sale * finalValue
      gift = {
        isGift: true,
        extraFee: 0,
        inventory: {},
        itemAmount: 0,
        qty: finalValue,
        exemptionQty: 0,
        discountAmount: 0,
        product: couponTemplate.giftProduct,
        coupons: [{ objectId: couponTemplate.objectId }],
        saleAmount: couponTemplate.giftProduct.price.sale,
        promoAmount: couponTemplate.typeInfo.isPromo ? discount : 0,
        couponAmount: couponTemplate.typeInfo.isPromo ? 0 : discount,
      }
      break
    }
  }
  return {
    gift,
    couponId,
    exemptionQty,
    discount,
    totalPrice: selectedPrice,
    totalQty: selectedQty,
  }
}

/**
 * 根据优惠条件直接计算
 * @param {*} payload
 */
function getDiscountValue(payload) {
  let { valueRules, isCoupon, value, coupons = [] } = payload
  //当isCoupon为true 则使用coupon
  let res = {
    finalValue: 0,
  }
  if (isCoupon && coupons.length > 0) {
    let i = -1
    let func = (coupon, index) => {
      let valueIndex = coupon.valueIndex
      let rule = valueRules[valueIndex]
      if ((value >= rule.condition || !rule.condition) && rule.value > res.finalValue) {
        i = index
        res.finalValue = rule.value
      }
    }
    coupons.forEach(function (coupon, index) {
      return func(coupon, index)
    })
    if (i > -1) {
      res.couponId = coupons[i].objectId
    }
  } else {
    valueRules.forEach(function (rule) {
      if (value >= rule.condition || !rule.condition) {
        let times = rule.limitType === LIMIT_TYPE.MIN ? 1 : Math.floor(value / rule.condition)
        if (rule.value * times > res.finalValue) {
          res.finalValue = rule.value * times
        }
      }
    })
  }
  return res
}

/**
 * 更新优惠商品价格
 * @param {*} payload
 */
function updateProductInfo(payload) {
  let { productInfos, percent, couponTemplate, discountTotal, discountByProductId, exemptionQtyByProductId } = payload
  let discount = 0
  productInfos.forEach(function (info, index) {
    let discountValue = 0
    if (discountByProductId) {
      discountValue = discountByProductId[info.product.objectId] || 0
    } else {
      if (index === productInfos.length - 1) {
        discountValue = discountTotal - discount
      } else {
        discountValue = parseInt(percent * info.itemAmount)
        discount += discountValue
      }
    }
    info.itemAmount -= discountValue
    if (couponTemplate.typeInfo.isPromo) {
      info.promoAmount += discountValue
    } else {
      info.couponAmount += discountValue
    }
    info.coupons.push({ objectId: couponTemplate.objectId })
    if (exemptionQtyByProductId) {
      info.exemptionQty = exemptionQtyByProductId[info.product.objectId] || 0
    }
  })
}

function finalCalculate(payload) {
  let {
    cart,
    couponChooseList,
    productInfoById,
    giftObject,
    subType,
    deliveryCouponsByTemplate,
    templateSortedList,
    deliveryFee,
    deliveryFeeForce,
    couponTemplateById,
  } = payload
  let items = [],
    giftItems = [],
    storeId = cart.storeId
  cart.items.forEach(item => {
    // 添加商品折扣后小计
    let productInfo = productInfoById[item.product.objectId] || []
    items.push(productInfo)
  })

  // 添加 PRODUCT  gift
  ENTITY_TYPES.forEach(function (str) {
    Object.keys(giftObject[str]).forEach(function (key) {
      let gift = giftObject[str][key]
      if (gift) giftItems.push(gift)
    })
  })

  // 拼接商品和赠品
  items = items.concat(giftItems)

  // 计算小计
  let subtotal = {
    itemAmount: 0,
    saleAmount: 0,
    couponAmount: 0,
    discountAmount: 0,
    promoAmount: 0,
    extraFee: 0,
    deliveryFee,
    deliveryFeeDiscount: 0,
  }
  items.forEach(item => {
    subtotal.itemAmount += item.itemAmount
    subtotal.saleAmount += item.saleAmount
    subtotal.couponAmount += item.couponAmount
    subtotal.discountAmount += item.discountAmount
    subtotal.promoAmount += item.promoAmount
    subtotal.extraFee += item.extraFee
  })
  if (subType === ORDER_SUBTYPE.takeout && deliveryFee > 0) {
    //判定如果运费券和之前使用的券有冲突则不使用
    Object.keys(deliveryCouponsByTemplate).forEach(function (key) {
      let template = couponTemplateById[key]
      if (!template) {
        return delete deliveryCouponsByTemplate[key]
      }
      templateSortedList.some(function (item) {
        let template2 = couponTemplateById[item.templateId]
        let isExcluded = getExcludeResult(template, template2)
        if (isExcluded) {
          delete deliveryCouponsByTemplate[key]
          return true
        }
      })
    })

    if (Object.keys(deliveryCouponsByTemplate).length > 0) {
      deliveryCalculate({
        subtotal,
        couponChooseList,
        deliveryCouponsByTemplate,
        deliveryFeeForce,
        templateSortedList,
      })
    }
  }
  return {
    storeId,
    items,
    subtotal,
    store: cart.store,
  }
}

/******************************************************** mainLogic ****************************************************************/

/******************************************************** Util ****************************************************************/

function getExcludeResult(t1, t2) {
  //要么是该商品已使用过的优惠与当前优惠互斥
  if (t1.excludeRange === 'notExcludedCouponTemplate') {
    let notIds = (t1.notExcludedCouponTemplate || []).map(function (item) {
      return item.objectId
    })
    if (!t1.isAllEffective) {
      if (notIds.indexOf(t2.objectId) === -1) {
        return true
      }
    }
  } else {
    if (t1.isAllEffective) {
      return true
    }

    let exIds = (t1.excludedCouponTemplate || []).map(function (item) {
      return item.objectId
    })
    if (exIds.indexOf(t2.objectId) !== -1) {
      return true
    }
  }

  //要么当前优惠的互斥包含了该商品已使用的优惠
  if (t2.excludeRange === 'notExcludedCouponTemplate') {
    let notIds = (t2.notExcludedCouponTemplate || []).map(function (item) {
      return item.objectId
    })
    if (!t2.isAllEffective) {
      if (notIds.indexOf(t1.objectId) === -1) {
        return true
      }
    }
  } else {
    if (t2.isAllEffective) {
      return true
    }
    let exIds = (t2.excludedCouponTemplate || []).map(function (item) {
      return item.objectId
    })
    if (exIds.indexOf(t1.objectId) !== -1) {
      return true
    }
  }
  return false
}

/**
 * 判断优惠与已使用优惠是否互斥 并且找到并不互斥的商品
 * @param {} payload
 */
function findTemplateValidProduct(payload) {
  let { template, productInfos, couponTemplateUsedByProduct, couponTemplateById, usedTemplateIds } = payload

  if (excludedMode === EXCLUDED_MODE.ORDER) {
    if (usedTemplateIds.length === 0) {
      return productInfos
    }
    let excluded = false
    //整单模式  只需要判断使用过的券是否与Template互斥
    usedTemplateIds.some(function (id) {
      let temp = couponTemplateById[id]
      excluded = getExcludeResult(temp, template)
      return excluded
    })
    return excluded ? [] : productInfos
  }

  productInfos = productInfos.filter(function (item) {
    let id = item.product.objectId
    let templates = couponTemplateUsedByProduct[id] || []
    let isExclude = false
    templates.some(function (tempId) {
      let ctemp = couponTemplateById[tempId]
      isExclude = getExcludeResult(ctemp, template)
      return isExclude
    })
    return !isExclude
  })
  return productInfos
}

/**
 * 通过运费券列表来计算最佳的运费券并使用
 * @param {*} payload
 */
function deliveryCalculate(payload) {
  let { deliveryCouponsByTemplate, couponChooseList, subtotal, deliveryFeeForce, templateSortedList } = payload
  let total = subtotal.itemAmount + subtotal.extraFee + subtotal.deliveryFee
  let max = 0,
    couponShouldUse = undefined

  Object.keys(deliveryCouponsByTemplate).forEach(function (key) {
    let coupons = deliveryCouponsByTemplate[key]
    coupons.forEach(function (coupon) {
      let temp = coupon.template
      let index = coupon.valueIndex
      let valueRules = temp.usageRule.valueRules
      let rule = valueRules[index]
      if (total >= rule.condition) {
        coupon.canBeUse = true
        if (!deliveryFeeForce && couponChooseList.indexOf(coupon.objectId) === -1) {
          //当不需要强制使用运费券 同时前端未选择运费券时不作处理
          return
        }
        if (rule.isAllDiscount || subtotal.deliveryFee < rule.value) {
          max = subtotal.deliveryFee
        } else {
          max = rule.value
        }
        couponShouldUse = coupon
      }
    })
  })
  if (couponShouldUse) {
    templateSortedList.push({
      templateId: couponShouldUse.template.objectId,
      isPromo: couponShouldUse.template.typeInfo.isPromo,
      couponId: couponShouldUse.objectId,
    })
  }

  if (subtotal.deliveryFee >= max) {
    subtotal.deliveryFeeDiscount = max
    subtotal.deliveryFee = subtotal.deliveryFee - max
  } else {
    subtotal.deliveryFeeDiscount = subtotal.deliveryFee
    subtotal.deliveryFee = 0
  }
  subtotal.couponAmount = subtotal.couponAmount + subtotal.deliveryFeeDiscount
}

/******************************************************** Util ****************************************************************/
