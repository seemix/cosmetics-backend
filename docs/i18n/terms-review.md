# Терміни на узгодження

Спірні переклади словника `src/i18n/` (CLAUDE.md, «Багатомовність»), які власнику варто перевірити.

| Ключ | en | ru | ro | Сумнів |
|---|---|---|---|---|
| `custom:term:debt` | Debt | Долг | Datorie | — |
| `custom:term:advance` | Advance payment | Аванс | Avans | В обліку «аванс» — сума, сплачена постачальнику наперед (мінусовий борг). Для покупця так само «передоплата» не використовується |
| `custom:term:carrier` | Carrier | Перевозчик | Transportator | Існує й `custom:field:isCarrier`; «перевізник» — постачальник логістики |
| `custom:term:overpayment` | Overpayment | Переплата | Plată în plus | RO: «Plată în plus» (дослівно «платіж понад»); альтернатива — «Supraplată» |
| `custom:term:discrepancy` | Discrepancy | Расхождение | Discrepanță | RO: «Neconcordanță» — м'якший варіант для звітів про розбіжності кешу |
| `custom:option:openingSupplierDebt` | Supplier debts | Долги поставщикам | Datorii față de furnizori | — |
| `custom:option:openingCustomerDebt` | Customer debts | Долги покупателей | Datoriile clienților | Борг за історичними замовленнями (покупець ще не доплатив) |
| `custom:error:customerDebtOrderNotHistorical` | historical orders | исторические заказы | comenzi istorice | «Історичне» = замовлення до вмикання обліку складу (без `stockPostedAt`) |
| `custom:term:payroll` | Payroll | Расчёт зарплаты | Calcul salarial | Документ нарахування за період. Альтернатива: RU «Ведомость», RO «Stat de plată» (але це радше список виплат кільком працівникам) |
| `custom:term:fixedSalary` | Fixed salary | Оклад | Salariu fix | RO: «Salariu de bază» звучить звичніше, але може плутатися з базою нарахування |
| `custom:term:percent` | Percent | Процент | Procent | RU: «Процент» vs «Комиссия, %» — що звичніше для власника |
| `custom:term:accrualBase` | Accrual base | База начисления | Baza de calcul | — |
| `custom:term:adjustment` | Adjustment | Корректировка | Ajustare | Премія (+) або штраф (−) одним полем; можливо, краще «Премия/штраф» |
| `custom:term:salaryPayment` | Salary payment | Выплата зарплаты | Plata salariului | — |
| `custom:term:salaryAdvance` | Salary advance | Аванс | Avans salarial | RU «Аванс» збігається з `custom:term:advance` (аванс постачальнику); у контексті зарплати це виплата без розрахунку |
| `custom:field:attribution` | Sales attribution | Принадлежность продаж | Atribuirea vânzărilor | Чий продаж: менеджер на момент замовлення (знімок) чи поточний менеджер клієнта |
| `custom:option:basePaidRevenue` | Paid revenue | Оплаченная выручка | Venituri încasate | — |
| `custom:option:customersRetail` | Retail (including guests) | Розничные (включая гостей) | Cu amănuntul (inclusiv vizitatori) | RO: «vizitatori» для гостьових замовлень; альтернатива — «clienți neînregistrați» |
| `custom:term:report` | Report | Отчёт | Raport | — |
| `custom:term:revenue` | Revenue | Выручка | Venituri | RO: «Cifra de afaceri» (оборот) — бухгалтерський термін; «Venituri» ширше (будь-які доходи) |
| `custom:term:cogs` | Cost of goods sold | Себестоимость продаж | Costul mărfurilor vândute | RU: коротше «Себестоимость», але вона ж `custom:term:cost` (собівартість одиниці/залишку); тут саме собівартість проданого |
| `custom:term:grossProfit` | Gross profit | Валовая прибыль | Profit brut | — |
| `custom:term:profit` | Profit | Прибыль | Profit | Без податків і ПДВ (П4): власнику варто знати, що це «операційний» прибуток касово-облікового методу |
| `custom:term:warehouseLosses` | Warehouse losses | Потери склада | Pierderi de stoc | Включає списання й нестачі інвентаризації мінус надлишки; альтернатива RU «Списания и недостачи» |
| `custom:term:expenses` | Expenses | Расходы | Cheltuieli | Касовий метод: лише проведені витрати з каси, без оплат постачальникам |
