# DACException_zh-CN

- Source CHM: DACException_zh-CN.chm
- Language: Simplified Chinese
- Converted: 2026-06-11

> This Markdown file is generated from the Simplified Chinese CHM package. Image references are preserved as source filenames; use the original CHM for exact screenshots and embedded media.

## Page Index

1. 客户端访问不到数据库服务器.htm

## 客户端访问不到数据库服务器.htm

Source page: `客户端访问不到数据库服务器.htm`

客户端访问不到数据库服务器

问题描述：

服务器电脑可以正常使用U8，客户端打开企业应用平台输好用户名密码可以选择账套点登录后提示：

连接U8数据库服务器失败，可能的原因：

1、 没有打开windows防火墙数据库端口

2、 对数据库服务器名进行DNS解析时出错

3、 配置数据源时指定的数据库服务器名或IP跟其实际IP值不匹配

这类问题主要发生在客户端连接服务器时，解决方案如下：

1.
关闭防火墙：

打开控制面板，找到“Windows
防火墙”，如下图所示，选择关闭，确定。

2．配置HOSTS文件：

找到系统安装的路径下\drivers\etc\hosts的路径，

如C:\WINDOWS\system32\drivers\etc\hosts

用记事本打开此文件，如图所示，在最后一行添加

服务器IP地址 服务器机器名

如：20.1.43.124 COLIN-PC

3
配置服务器端数据库：

在开始菜单中找到SQL Server的启动的快捷方式的菜单，在“配置工具”中找到“SQL Server配置管理器” ，双击打开，如下图所示：

在左树“SQL Server网络配置”中找到
“MSSQLSERVER的协议” ，分别右击“Name Pipes”和“TCP/IP” ，选择启动，重新启动产品即可。
