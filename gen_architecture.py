import sys
sys.path.insert(0, "/home/mao/.claude/plugins/marketplaces/maoqb-skills/skills/drawio-diagrams/scripts")
from drawio import BlockDiagram

bd = BlockDiagram("release_config 整体架构")

# Row 0: Inputs
src_files = bd.block("源树文件\n(flag_declarations / release_configs\n flag_values / release_config_map)", col=0, row=0, color="blue")
env_maps  = bd.block("PRODUCT_RELEASE_CONFIG_MAPS\n(env var / soong_ui 输出)", col=2, row=0, color="blue")

# Row 1: Caller
rc_mk = bd.block("release_config.mk\n(Kati makefile，编译入口)", col=1, row=1, color="yellow")

# Row 2: Main binary
main_bin = bd.block("release-config-internal\n(release_config/main.go)", col=1, row=2, color="green")

# Row 3: Library + Proto
lib = bd.block("release_config_lib\n(并发加载 + 继承解析 + 产物生成)", col=1, row=3, color="green")
proto = bd.block("release_config_proto\n(proto 数据定义层)", col=3, row=3, color="purple")

# Row 4: Outputs
varmk   = bd.block("release_config-<product>.varmk\n(RELEASE_* make 变量)", col=0, row=4, color="orange")
artifact = bd.block("all_release_configs-<product>.{pb,json,textproto}\n(完整 release configs 产物)", col=1, row=4, color="orange")
dot_file = bd.block("inheritance_graph-<product>.dot\n(继承关系图)", col=2, row=4, color="orange")

# Connections
bd.connect(src_files, lib, "读取")
bd.connect(env_maps, main_bin, "map 路径")
bd.connect(rc_mk, main_bin, "KATI_shell_no_rerun 调用")
bd.connect(main_bin, lib, "调用")
bd.connect(lib, proto, "使用")
bd.connect(lib, varmk, "写入")
bd.connect(lib, artifact, "写入（可选）")
bd.connect(lib, dot_file, "写入（可选）")
bd.connect(varmk, rc_mk, "include 回读", dashed=True)

bd.group("输入", [src_files, env_maps])
bd.group("核心处理", [main_bin, lib])
bd.group("产物输出", [varmk, artifact, dot_file])

bd.save("/home/mao/code/android-16.0.0_r4/release_config/release_config_architecture.drawio")
bd.save_svg("/home/mao/code/android-16.0.0_r4/release_config/release_config_architecture.svg")
print("Saved architecture diagram")
