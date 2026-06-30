"""display_images 单元测试"""

from src.display_images import tools_rois_to_json


def test_tools_rois_to_json_includes_cam():
    config = {
        "tools": [
            {
                "id": "01",
                "cam": 0,
                "enabled": True,
                "roi": {"shape": "rect", "x": 1, "y": 2, "w": 3, "h": 4},
            },
            {
                "id": "02",
                "cam": 1,
                "enabled": True,
                "roi": {"shape": "rect", "x": 5, "y": 6, "w": 7, "h": 8},
            },
            {"id": "03", "enabled": False, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 1, "h": 1}},
        ]
    }
    items = tools_rois_to_json(config)
    assert len(items) == 2
    assert items[0]["cam"] == 0
    assert items[1]["cam"] == 1
