cd server; bash build.sh; cd ..
#exit
#cd others/resolume; bash build.sh; cd ../..

zip -r lenverse-$(date "+%Y-%m-%d").zip \
    server/ \
    modules/ \
    var/ \
    visual/ \
    bibles/ \
    songs/ \
    media/ \
    others/ \
    README.md \
