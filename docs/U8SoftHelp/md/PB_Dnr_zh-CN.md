# PB_Dnr_zh-CN

- Source CHM: PB_Dnr_zh-CN.chm
- Language: Simplified Chinese
- Converted: 2026-06-11

> This Markdown file is generated from the Simplified Chinese CHM package. Image references are preserved as source filenames; use the original CHM for exact screenshots and embedded media.

## Page Index

1. AccumulateSUM
2. APIOfCustomFilter
3. args
4. CalcuateUnitSUM
5. CalculateTheRemainderOfLine
6. CardPattern
7. CardPattern2
8. cell
9. CellRights
10. cells
11. ChartDesignInRuntime
12. ChartOfCustomReport
13. 切换语言
14. 版权声明
15. Cross
16. CrossReport
17. 交叉设置
18. CumputeLogic
19. current
20. currentgroup
21. CustomAction
22. CustomDataSource
23. CustomFilterPage
24. CustomReport
25. datahelper
26. 维度扩展
27. DisplayInDifferentRows
28. DisplayMode
29. ExportEventOfCell
30. ExportEventOfReport

## AccumulateSUM

Source page: `accumulatesum.htm`

[Image: image56.gif]

### 累计汇总

【功能介绍】

累计汇总即将各分组的小计作累计运算。

【操作流程】

-

设定字段"计算类型"为"AccumulateSUM"

【效果】

-

将金额字段的"计算类型"设置为"AccumulateSUM"，则每月累计为"当月值+前期累计值"

## APIOfCustomFilter

Source page: `apiofcustomfilter.htm`

### 自定义过滤界面接口

【接口函数】

public interface ISelfFilter

{

void ShowFilter(IFilterArgs e);

}

【参数介绍】

IFilterArgs参数请参考IGetSql说明。

【应用实例】

(假设要绑定的组件名为CustomFilter，实现ISelfFilter的类型为clsFilter)：

在UAP中"报表定义"窗体的工具栏的"查询条件"按钮中选择"自定义条件"，或在"报表定义"窗体的右键菜单的"查询条件"菜单中选择"自定义条件"，如图：

[Image: image47.gif]

之后再打开的定义窗体中输入组件信息，如：

[Image: image48.gif]

点击"确定"即可完成绑定操作。

## args

Source page: `args.htm`

### args

【功能介绍】

传递参数

【对象函数】

取参数对象：

object
this[string key]

取参数对象：

object GetValue(string key);

【用例】

args["filterflag"]

## CalcuateUnitSUM

Source page: `calcuateunitsum.htm`

[Image: image27.gif]

[Image: image53.jpg]

[Image: image28.gif]

[Image: image29.gif]

### 按计量单位汇总

【功能介绍】

按计量单位汇总即按计量单位分类进行汇总运算。

【操作流程】

-

必须是自由报表

-

将数量字段的计量单位属性设置为"单位"数据源

-

删除原有"单位"字段，重新添加一个"文本数据"类型字段，将数据源指向"单位"

【效果】

-

小计可以分别按照计量单位"个"、"箱"、"台"汇总

## CalculateTheRemainderOfLine

Source page: `calculatetheremainderofline.htm`

### 计算行余额

应收款--应收总帐--余额--本币

## CardPattern

Source page: `cardpattern.htm`

### 卡片式（样式一）

【效果】

-

自由视图报表的卡片式报表

[Image: image128.gif]

## CardPattern2

Source page: `cardpattern2.htm`

### 卡片式（样式二）

【效果】

-

自由视图报表的卡片式列表（带图片）

[Image: image54.jpg]

## cell

Source page: `cell.htm`

### cell

【功能介绍】

字段函数，获取列信息

【对象函数】

字段索引：

int CrossIndex

字段值：

object Value

字段背景色：

Color BackColor

字段字体色：

Color ForeColor

字段名称：

object Caption

## CellRights

Source page: `cellrights.htm`

[Image: image110.jpg]

[Image: image129.gif]

[Image: image151.jpg]

### 字段权限

通过设置商业敏感数据进行报表视图的字段权限控制

【操作流程】

-

设置需要控制权限字段的"是否控制权限"属性为"True"，保存视图，如图

-

使用敏感数据维护工具建立字段与敏感数据对象建立映射关系，如图

-

在门户数据权限设置控制中选择相应的业务对象，如图

-

在数据权限分配中为用户或角色授权

## cells

Source page: `cells.htm`

### cells

【功能介绍】

字段组函数，获取指定字段

【对象函数】

获取指定列：

Cell this[string name]

## ChartDesignInRuntime

Source page: `chartdesigninruntime.htm`

[Image: image103.gif]

[Image: image104.gif]

[Image: image102.gif]

### 运行时图表设计

运行时图表设计功能，使用户在报表运行时可以很方便快捷的制作一张图表，并提供图表的输出、打印功能。

【图表管理器】

-

在图表展示界面点击"切换图表方案"可以切换查看已有的图表；

-

有几级分组就可以制作几级图表，每一级图表可以保存为不同的方案。

-

点击"图表管理器"进入到图表管理设计界面，对可以右键添加新增，删除，复制方案；

【操作流程】

-

在门户中打开一张报表；

-

对报表进行分组，点击报表下方的"图表"页签；

-

点击"图表管理器"，选择图表向导创建统计图表

-

选择图表类型，图表类型包括：柱形图、多层柱形图、曲线图、区域图、条形图、多层条形图、齿形图、3D饼图、饼图、圆环图、3D圆环图、齿形区域图、多层区域图、多层齿形区域图、多层曲线图、多层齿形图,如图

-

设置显示特征,如图

-

设置图例:可以选择是否显示图例，设置图例显示的位置（左边、右边、上边或下边）

-

标签角度：设置角度，运行时柱形图横坐标文字以倾斜x角度显示，默认与X轴平行。

-

数据绑定，这一步选择报表中的数值字段作为图表的Y轴、Z轴。Y轴为所选择数据的值，Z轴为所选择的不同数据源（选择几个数据源Z轴就有几个刻度，只有一个数据源时Z轴无效）,如图

-

从零开始数据：如果数据区间不包含零值，可以使用该设置来将数据中最小的值作为图表轴的基准值。

-

交换行列值：通过该设置可以将数据源中的行列值调换。

【关键特性】

-

需要制作图表的报表必须有分组，分组项默认作为图表的X坐标轴

-

有几级分组就可以制作几级图表，如报表有两级分组，那么就可以设计1级图表和2级图表。1级图表可以直接打开，1级分组作为图表的X轴；2级图表需要通过在报表结构图选择相应的2级分组才能打开2级图表，2级分组作为2级图表的X轴

-

2级分组可以通过双击1级分组图表中的图形打开。

## ChartOfCustomReport

Source page: `chartofcustomreport.htm`

[Image: image203.jpg]

### 自由报表自定义图表

自由报表在设计时可以在"报表汇总区"设置图表

【操作流程】

-

设计一张有分组的自由报表

-

在"报表组件"中将"图表"拖入"报表汇总区"

-

在"图表"的属性栏中通过"ChartWizard"属性设计图表，如图。向导设置参见报表运行时图表设计

## 切换语言

Source page: `chnglang.htm`

[Image: image110.gif]

### 切换语言

支持按简体中文、繁体中文、英文三种语言状态的报表视图设计。

【功能路径】

-

报表视图目录区域右键菜单"切换语言"。

【操作说明】

-

点击右键菜单"切换语言"，下有三个选项，如图。

-

选择简体中文，则视图的名称及视图上标签语言都切换成简体中文。

-

选择繁体中文，则视图的名称及视图上标签语言都切换成繁体中文。

-

选择英文，则视图的名称及视图上标签语言都切换成英文。

## 版权声明

Source page: `copyright.htm`

### 版权声明

用友软件股份有限公司

## Cross

Source page: `cross.htm`

### 交叉方案

在交叉视图中，按所选择的行、列进行交叉计算，根据数据生成交叉列。同样在表格视图中通过设置交叉方案基本能够代替交叉视图。详细见运行时交叉方案

## CrossReport

Source page: `crossreport.htm`

[Image: image95.gif]

[Image: image50.jpg]

[Image: image51.jpg]

[Image: image206.jpg]

[Image: image207.jpg]

[Image: image208.jpg]

### 交叉视图

交叉视图报表提供了交叉计算功能，可以自动根据报表数据形成交叉列。

【操作流程】

-

选择交叉视图形式，如图。报表视图分为"表格视图"、"自由视图"、"交叉视图"和"监控视图"。

-

方法一：

-

使用报表向导，选择交叉行/列，如图。

-

选择报表列信息，点击"下一步"，如图。可以选择属性列是否汇总的属性。

-

方法二：

-

在数据源窗口直接拖拽字段到画布中对应的区域（如行标题区、列标题区、交叉区），如图。

-

在画布区选择报表组件，在属性窗口设置报表组件的属性，如图。

-

完成报表设计后，保存设置。

【功能说明】

-

交叉视图提供了交叉计算功能，交叉列必须为数值型字段。

-

交叉视图支持数值型行标题。

-

交叉视图中日期型行/列标题支持时间维度，目前系统支持年、月、日、时间、周、季、会计月、旬等时间纬度。时间纬度在"属性"窗口中设置，如图。

-

备注：表格视图和监控视图也支持时间纬度，自由视图不支持。

-

注：报表组件的属性在属性窗口中设置.

## 交叉设置

Source page: `crossset.htm`

[Image: image165.jpg]

[Image: image101.gif]

[Image: image169.jpg]

### 动态交叉设置

### 在报表运行时提供交叉设置界面，可以设置交叉区，并可以保存多种交叉方案。如图

### 【操作流程】

-

在报表工具栏上点击"交叉"按钮，弹出编辑"交叉方案"界面，如图，支持设置默认交叉方案；

-

点击新增按钮，弹出交叉设置界面，如图；

-

左侧为可分租项目，此列表显示显示已经在报表中使用的字段；

-

选择要使用的字段并将其拖到适当的列表中，或者单击适当的箭头按钮。

-

行标题区：此列表显示已选择作为交叉表行标题的字段。如果有多个行标题，则它们将按出现在此列表中的顺序出现在报表上。
行标题支持分级结构（将一个项目拖拽到另一个项目下即可），和分组级次类似。多级行标题支持折叠显示。

-

列标题：此列表显示已选择作为交叉表列标题的字段。

-

交叉点：不支持两层以上的交叉结果展现。一个交叉点最多可以设置二个列标题，多个交叉点只能设置一个列标题。

-

日期维度：如果选择了"日期"型字段，则日期维度列表会变为可用并且包含适用于该字段类型的选项。例如，如果您选取了一个日期字段，则您可以选择的选项包括"日"、"周"、"月"等。

### 【规则】

-

仅支持表格报表，其他类型报表不支持。

## CumputeLogic

Source page: `cumputelogic.htm`

### 计算逻辑

【功能介绍】

用于比一般表达式更为复杂的计算

【环境变量】

previous，current，global，currentindex，startindex，endindex，groups，currentgroup，filter，args，datahelper，cell，reportsummarydata

【常用场景】

计算行余额

【应用实例】

应收管理--应收余额表

## current

Source page: `current.htm`

### current

【功能介绍】

获取当前行

【对象函数】

获取当前行的某列：

object
current[columnname]

获取当前行的某列：

.columnname -----列值

【用例】

current.订单号

current["订单号"]

## currentgroup

Source page: `currentgroup.htm`

### currentgroup

【功能介绍】

分组函数，获取当前组信息

【对象函数】

获取分组：

string this[string
name]

获取下级分组：

Groups ChildGroups

获取上级分组：

Group Parent

分组的可见性：

bool Visible

分组的级次：

int Level

## CustomAction

Source page: `customaction.htm`

### 自定义行为

【接口函数】

public interface IExecute

{

void Execute(IActionArgs e);

}

【参数介绍】

IActionArgs是在进行自定义行为的时候数据交互的媒介，IActionArgs中的常用参数:

IActionArgs.ReportID:当前操作的报表ID

IActionArgs.Login:U8的Login对象

IActionArgs.RelateData:当前报表的相关数据对象，通过此对象中的接口GetData可获得相关的数据

IActionArgs.CurrentColumnName:触发自定义行为时报表所处的焦点行名称

IActionArgs.FltArgs:IFilterArgs对象

【应用实例】

(假设组件名为ExcuteSample，类型名为clsExc，定义方法参考IGetSql的示例)

[Image: image97.jpg]

在报表设计界面点击"自定义行为"的按钮 ，将打开自定义行为的定义界面：

[Image: image44.gif]

点击"新增":

[Image: image45.gif]

设定ActionClass为"ExcuteSample.clsExc",

Caption为"自定义例子",点击"确定"即完成绑定操作。

保存之后打开报表，其右键菜单"其他"的子菜单中便出现定义的新菜单，

[Image: image46.gif]

点击此子菜单，便会调用类型clsExc中的Execute方法。

## CustomDataSource

Source page: `customdatasource.htm`

### 自定义数据源

【接口函数】

public interface IGetSql

{

void GetSql(IFilterArgs e);

}

【参数介绍】

IFilterArgs参数是UFIDA.U8.UAP.Services.ReportFilterService.tlb中的类型，在报表系统调用自定义数据源组件的时通过此参数将组件需要的环境信息传入，而自定义数据源组件则将其处理结果通过此参数返回给报表系统。

IFilterArgs中包含的常用接口：

IFilterArgs.login：U8的Login对象

IFilterArgs.RawFilter：过滤对象

IFilterArgs.DataSource.Type：组件数据源返回类型，其值与对应类型为

0：SQL脚本

1：存储过程

2：临时表

其默认值为2

IFilterArgs.DataSource.Sql：SQL脚本或临时表名称

IFilterArgs.DataSource.StoreProcName：存储过程名称

【应用实例】

-

以下提供一个名为CustomDataSample的vb6.0的dll，此组件中定义一个名为customData.cls类，其代码如下（IFilterArgs的）：

Public Sub GetSql(e As IFilterArgs)

e.DataSource.sql
= ?select * from AA_Bank?

e.DataSource.Type
= 0

End Sub

生成该组件并注册。

-

绑定到报表的数据源,过程如下：

[Image: image41.gif]

选择"下一步"直到：

[Image: image42.gif]

此处的"数据源服务类型信息"必须是"组件名.类型名"的形式，在这个例子中此名称则为：CustomDataSample.customData，

而"数据源服务组件类型"在本例中则为Com。

选择完成即可完成数据源绑定。

## CustomFilterPage

Source page: `customfilterpage.htm`

### 自定义过滤

用户可以使用自定义的过滤条件，比如出口的过滤。参考《二次开发手册》中的"自定义过滤界面接口"

## CustomReport

Source page: `customreport.htm`

[Image: image94.gif]

[Image: image200.jpg]

[Image: image127.gif]

### 自由视图

自由视图报表的表格样式较表格报表灵活，用户可以根据需要设计各式各样的报表，比如卡片式报表。自由报表还支持动态图片功能。

【操作流程】

-

选择自由视图形式，如图。报表视图分为"表格视图"、"自由视图"、"交叉视图"和"监控视图"。

-

报表格式设计，添加列、设置列属性、设计分组、使用报表向导、设计级次展开、切换语言。

-

完成报表设计。

【效果】

-

分组展开：以地区分组（隐藏了"地区"标题），明细数据可以折叠。

如图

-

无分组：以列表形式展示。

如图

## datahelper

Source page: `datahelper.htm`

### datahelper

【功能介绍】

获取系统参数

【对象函数】

执行SQL语句：

void
ExecuteNonQuery(string sql)

执行SQL语句，返回结果：

object ExecuteScalar(string sql)

执行SQL语句，返回结果：

DataSet Exec(string sql)

在Meta库中执行SQL语句，返回结果：

DataSet ExecFromMeta(string sql)

用户名：

string UserName

当前日期:

string Date

当前时间：

string Time

当前年：

int Year

当前月：

int Month

当前日：

int Day

帐套年：

int AccountYear

帐套月：

int AccountMonth

用户自定义参数：

string CusDefineInfo(string key)

公司信息：

string CompanyInfo(string key)

【用例】

datahelper.CusDefineInfo("@存货.自定义项1")

## 维度扩展

Source page: `dimensionexpand.htm`

[Image: image133.jpg]

[Image: image134.jpg]

[Image: image12.jpg]

[Image: image24.gif]

[Image: image25.gif]

[Image: image26.gif]

左连接--包含所有左边表中的记录甚至是右边表中没有和它匹配的记录。即左连接的时候左侧表中的数据会全部显示,如果左表的某行内容无法在右表中找到相对的行,则将右表内容用空来表示.

[Image: image139.jpg]

### 报表维度扩展

报表维度扩展是对于报表查询、分析的一个补充，同时也是为满足客户对系统更多报表查询要求的一个预留接口。因为每个客户、每类客户对于报表数据的要求、侧重都不一样，系统不可能提前预知用户的要求，有了报表维度扩展就可以针对客户的一些特殊需求进行补充。如图

【功能路径】

-

报表运行时-更多设置-维度扩展

-

报表设计时-报表设计器中-点击报表-右键菜单；如图

【操作流程】

1.报表上右键菜单点击"维度扩展"按钮，进入维度扩展界面，如图；

2.从界面右侧常用视图和全部实体中选中并双击增加实体，选择增加的实体和实体的属性列，如图；定义后显示扩展的属性列，也可双击实体进行属性列的修改，如图；

3.在实体上拖拽进行关联设置，也可以右键设置实体间关系或者自定义关联，如图；

4.可以定义多个实体的关联，关联遵守左连接原则，左连接详细；

5.设置完毕，在运行时可以查看扩展的字段。

【功能说明】

-

如果要恢复原有报表，则在设计时把添加的实体和设置的关联去掉即可。

-

在增加新的过滤条件时，过滤条件中可以选择扩展实体的属性作为过滤条件数据源，如图。

-

如果实体之间的关联线为红色，则表示关联定义不完整，需要重新设置；如果实体之间的关联线为蓝色，则表示是自定义关联。

-

报表维度扩展默认源报表为主实体，"设置主实体"功能不可用。

【权限】

-

功能权限：有报表"格式"设置权限的用户可进行维度扩展。

-

数据权限：维度扩展字段的数据权限同目标实体的数据权限，即如果目标实体没有某字段权限，报表维度扩展后也无法看到该字段内容。

## DisplayInDifferentRows

Source page: `displayindifferentrows.htm`

[Image: image57.gif]

### 折行显示

【操作流程】

-

利用自由报表的字段自由排列特性，将字段按双行排列，如图

## DisplayMode

Source page: `displaymode.htm`

[Image: image94.jpg]

[Image: image92.jpg]

[Image: image93.jpg]

### 展现方式选择

电子表格展现中增加展现方式选择功能，用户可以随意按照 "折叠样式"、"平面展开"或"合并分组格"的形式展开报表

【操作流程】

-

打开有分组的表格报表或交叉报表，在报表展现区域点击鼠标右键，打开右键菜单。

-

切换展现样式为"折叠样式"、"平面样式"或"合并分组格"。

【效果】

-

折叠样式：折叠分组明细数据，可以展开显示。如图

-

平面样式：默认展开所有分组项。如图

-

合并分组格：在平面样式的基础上合并分组项的单元格，结构更清晰。如图

## ExportEventOfCell

Source page: `exporteventofcell.htm`

### Cell的输出时事件

【功能介绍】

报表计算完成后触发，按照特定条件修改字段属性

【环境变量】

report，groups，currentgroup，cell，cells，filter，args，datahelper，current，rows，global，reportsummarydata

【常用场景】

突出显示效果，设置cell.ForeColor
或者 cell.BackColor。计算cell.Caption等。在输出前事件中计算诸如百分比之类的值，是效率最高的一种算法。在交叉表中，如果要使用交叉后的结果进行计算，需要在该事件中进行计算。交叉点交叉后的列的命名规则：
交叉点的MapName + "__"（两条下划线）+cell.CrossIndex.ToString()

【应用实例】

服务管理--故障分析表

## ExportEventOfReport

Source page: `exporteventofreport.htm`

### Report输出前事件

【功能介绍】

报表计算完成后触发

【环境变量】

report，groups，filter，args，datahelper，global

【常用场景】

报表计算完成后触发的事件
